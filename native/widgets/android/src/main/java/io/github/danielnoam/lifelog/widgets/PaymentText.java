package io.github.danielnoam.lifelog.widgets;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What a Google Wallet payment notification says (0.238.0): how much, in
 * what, and where. Plain Java, so WidgetLogicTest runs it on the JVM.
 *
 * Wallet puts the merchant in the title and the amount in the text
 * ("₪45.90 with Visa •••• 1234"), in the phone's language; older builds put
 * both in one line ("Paid $4.50 at Starbucks"). Rather than match a sentence
 * that changes with every language and release, this looks for a currency
 * next to a number, and takes the other line as the merchant. A notification
 * with no amount in it (a pass, a card being added) reads as no payment.
 */
final class PaymentText {

    static final class Payment {
        final String amount;   // "45.90": a plain decimal, as typed into the form
        final String currency; // "ILS"
        final String shown;    // "₪45.90", as the notification had it
        final String merchant;

        Payment(String amount, String currency, String shown, String merchant) {
            this.amount = amount;
            this.currency = currency;
            this.shown = shown;
            this.merchant = merchant;
        }
    }

    // Longest first, so "CA$" is never read as "$". The same set the app's
    // currency menu has, less "kr", which three currencies share.
    private static final Map<String, String> SYMBOLS = new LinkedHashMap<>();
    static {
        String[][] pairs = {
            {"US$", "USD"}, {"CA$", "CAD"}, {"NZ$", "NZD"}, {"HK$", "HKD"}, {"MX$", "MXN"},
            {"A$", "AUD"}, {"S$", "SGD"}, {"R$", "BRL"}, {"zł", "PLN"}, {"Kč", "CZK"}, {"Ft", "HUF"},
            {"₪", "ILS"}, {"$", "USD"}, {"€", "EUR"}, {"£", "GBP"}, {"¥", "JPY"}, {"₺", "TRY"},
            {"฿", "THB"}, {"₩", "KRW"}, {"₹", "INR"},
        };
        for (String[] p : pairs) SYMBOLS.put(p[0], p[1]);
    }
    private static final String CODES = "ILS|USD|EUR|GBP|CHF|JPY|SEK|NOK|DKK|PLN|CZK|HUF|TRY|AED|THB|CAD|AUD|NZD|SGD|HKD|KRW|INR|MXN|BRL|ZAR";

    private static final String NUM = "\\d[\\d.,' \\u00a0\\u202f]*\\d|\\d";
    private static final Pattern MONEY;
    static {
        StringBuilder sym = new StringBuilder();
        for (String s : SYMBOLS.keySet()) {
            if (sym.length() > 0) sym.append('|');
            sym.append(Pattern.quote(s));
        }
        String cur = "(?:" + sym + "|\\b(?:" + CODES + ")\\b)";
        String gap = "[\\s\\u00a0\\u202f]?";
        MONEY = Pattern.compile("(" + cur + ")" + gap + "(" + NUM + ")|(" + NUM + ")" + gap + "(" + cur + ")");
    }

    // Direction marks and isolates: a Hebrew notification wraps the amount
    // in them, and they'd sit between the symbol and the number.
    private static final Pattern BIDI = Pattern.compile("[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u061c]");
    private static final Pattern REFUND = Pattern.compile("refund|החזר|reembolso|remboursement|erstattung|rimborso", Pattern.CASE_INSENSITIVE);

    private PaymentText() {}

    static Payment parse(String title, String text) {
        String t = clean(title), x = clean(text);
        if (REFUND.matcher(t + " " + x).find()) return null;
        Payment p = find(x, t);
        return p != null ? p : find(t, x);
    }

    /** The amount from `where`; the merchant is `other`, or what's left of `where`. */
    private static Payment find(String where, String other) {
        Matcher m = MONEY.matcher(where);
        while (m.find()) {
            String cur = m.group(1) != null ? m.group(1) : m.group(4);
            String num = m.group(2) != null ? m.group(2) : m.group(3);
            String amount = number(num);
            if (amount == null) continue;
            String code = SYMBOLS.containsKey(cur) ? SYMBOLS.get(cur) : cur.toUpperCase(Locale.ROOT);
            String merchant = other;
            if (merchant.isEmpty()) {
                String rest = (where.substring(0, m.start()) + " " + where.substring(m.end())).trim();
                Matcher at = Pattern.compile("(?:^|\\s)(?:at|to|ב-?|bei|chez|en|a)\\s+(.+)$", Pattern.CASE_INSENSITIVE).matcher(rest);
                merchant = at.find() ? at.group(1).trim() : "";
            }
            return new Payment(amount, code, m.group().trim(), merchant.length() > 120 ? merchant.substring(0, 120).trim() : merchant);
        }
        return null;
    }

    /**
     * "1,234.56", "1.234,56", "45,90", "1 234" to a plain decimal, or null.
     * With both separators the last is the decimal point; a lone comma is one
     * only before exactly two digits ("45,90", but "1,250" is a thousand).
     */
    static String number(String s) {
        s = s.replaceAll("[' \\u00a0\\u202f]", "");
        int dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
        if (dot >= 0 && comma >= 0) {
            char dec = dot > comma ? '.' : ',';
            char group = dec == '.' ? ',' : '.';
            s = s.replace(String.valueOf(group), "").replace(dec, '.');
        } else if (comma >= 0) {
            s = s.matches("\\d+,\\d{2}") ? s.replace(',', '.') : s.replace(",", "");
        } else if (s.indexOf('.') != dot) {
            s = s.replace(".", ""); // "1.234.567"
        }
        if (!s.matches("\\d+(\\.\\d+)?")) return null;
        BigDecimal v = new BigDecimal(s);
        return v.signum() > 0 ? v.toPlainString() : null;
    }

    private static String clean(String s) {
        return s == null ? "" : BIDI.matcher(s).replaceAll("").replaceAll("\\s+", " ").trim();
    }
}
