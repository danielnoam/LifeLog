package io.github.danielnoam.lifelog.widgets;

import android.content.Context;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.aggregate.AggregateMetric;
import androidx.health.connect.client.aggregate.AggregationResultGroupedByPeriod;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.metadata.DataOrigin;
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import java.time.LocalDate;
import java.time.Period;
import java.time.ZoneId;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlin.jvm.functions.Function2;
import kotlinx.coroutines.BuildersKt;
import kotlinx.coroutines.CoroutineScope;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Health Connect, read for src/health.js: steps per day, workout sessions
 * and sleep sessions, as plain numbers. Nothing is decided here (what counts
 * for which habit is the page's); this only reads what was granted.
 *
 * Health Connect's client is Kotlin with suspend functions; each call here
 * runs one to the end with runBlocking, so these methods block and are only
 * called off the main thread (HealthPlugin's executor, HeadlessRefresh's
 * worker thread). Used by the app (HealthPlugin) and by the background
 * refresh's run with no screen (HeadlessRefresh.Shim.healthRead).
 */
final class HealthReader {

    static final String PROVIDER = "com.google.android.apps.healthdata";
    static final String STEPS = "android.permission.health.READ_STEPS";
    static final String EXERCISE = "android.permission.health.READ_EXERCISE";
    static final String SLEEP = "android.permission.health.READ_SLEEP";
    static final String BACKGROUND = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND";
    // HealthConnectClient.SDK_UNAVAILABLE / _PROVIDER_UPDATE_REQUIRED / SDK_AVAILABLE.
    private static final int SDK_UNAVAILABLE = 1;
    private static final int SDK_UPDATE = 2;
    private static final int SDK_AVAILABLE = 3;
    private static final int PAGE = 1000;
    private static final int MAX_PAGES = 20;

    private HealthReader() {}

    interface Suspended {
        Object call(Continuation<Object> c);
    }

    /** A suspend call, run to the end on this thread. */
    @SuppressWarnings({ "unchecked", "rawtypes" })
    static <T> T await(Suspended s) throws InterruptedException {
        Function2<CoroutineScope, Continuation<Object>, Object> block = (scope, c) -> s.call(c);
        return (T) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (Function2) block);
    }

    /** "available", "missing" (not installed), "update" (too old), or "unavailable" (this phone can't). */
    static String sdk(Context c) {
        int s;
        try {
            s = HealthConnectClient.Companion.getSdkStatus(c, PROVIDER);
        } catch (Throwable t) {
            return "unavailable";
        }
        if (s == SDK_AVAILABLE) return "available";
        if (s == SDK_UPDATE) return "update";
        if (s == SDK_UNAVAILABLE) return android.os.Build.VERSION.SDK_INT >= 28 ? "missing" : "unavailable";
        return "unavailable";
    }

    static HealthConnectClient client(Context c) {
        return HealthConnectClient.Companion.getOrCreate(c, PROVIDER);
    }

    static Set<String> granted(Context c) throws InterruptedException {
        if (!"available".equals(sdk(c))) return Collections.emptySet();
        HealthConnectClient hc = client(c);
        Set<String> got = await((k) -> hc.getPermissionController().getGrantedPermissions(k));
        return got == null ? Collections.emptySet() : got;
    }

    /** { sdk, granted: [...] } */
    static JSONObject status(Context c) {
        JSONObject out = new JSONObject();
        try {
            out.put("sdk", sdk(c));
            out.put("granted", new JSONArray(granted(c)));
        } catch (Exception e) {
            try { out.put("granted", new JSONArray()); } catch (Exception x) { /* can't happen */ }
        }
        return out;
    }

    /**
     * { from: "YYYY-MM-DD", to: "YYYY-MM-DD", steps, workouts, sleep } →
     * { steps: [{ date, count }], workouts: [{ start, end, type }], sleep: [{ start, end }] },
     * times in ms. Sleep reaches back a day, so the night that ended on `from` is whole.
     */
    static JSONObject read(Context c, JSONObject opts) throws Exception {
        if (!"available".equals(sdk(c))) throw new IllegalStateException("Health Connect isn't available");
        HealthConnectClient hc = client(c);
        Set<String> got = granted(c);
        ZoneId zone = ZoneId.systemDefault();
        LocalDate from = LocalDate.parse(opts.optString("from"));
        LocalDate to = LocalDate.parse(opts.optString("to"));
        if (to.isBefore(from)) to = from;
        JSONObject out = new JSONObject();

        JSONArray steps = new JSONArray();
        if (opts.optBoolean("steps") && got.contains(STEPS)) {
            Set<AggregateMetric<?>> metrics = new HashSet<>();
            metrics.add(StepsRecord.COUNT_TOTAL);
            AggregateGroupByPeriodRequest req = new AggregateGroupByPeriodRequest(
                metrics,
                TimeRangeFilter.Companion.between(from.atStartOfDay(), to.plusDays(1).atStartOfDay()),
                Period.ofDays(1),
                Collections.<DataOrigin>emptySet());
            List<AggregationResultGroupedByPeriod> days = await((k) -> hc.aggregateGroupByPeriod(req, k));
            for (AggregationResultGroupedByPeriod d : days) {
                Long n = d.getResult().get(StepsRecord.COUNT_TOTAL);
                if (n == null || n <= 0) continue;
                steps.put(new JSONObject().put("date", d.getStartTime().toLocalDate().toString()).put("count", n));
            }
        }
        out.put("steps", steps);

        JSONArray workouts = new JSONArray();
        if (opts.optBoolean("workouts") && got.contains(EXERCISE)) {
            for (ExerciseSessionRecord r : records(hc, ExerciseSessionRecord.class,
                    TimeRangeFilter.Companion.between(from.atStartOfDay(zone).toInstant(), to.plusDays(1).atStartOfDay(zone).toInstant()))) {
                workouts.put(new JSONObject()
                    .put("start", r.getStartTime().toEpochMilli())
                    .put("end", r.getEndTime().toEpochMilli())
                    .put("type", r.getExerciseType()));
            }
        }
        out.put("workouts", workouts);

        JSONArray sleep = new JSONArray();
        if (opts.optBoolean("sleep") && got.contains(SLEEP)) {
            for (SleepSessionRecord r : records(hc, SleepSessionRecord.class,
                    TimeRangeFilter.Companion.between(from.minusDays(1).atStartOfDay(zone).toInstant(), to.plusDays(1).atStartOfDay(zone).toInstant()))) {
                sleep.put(new JSONObject()
                    .put("start", r.getStartTime().toEpochMilli())
                    .put("end", r.getEndTime().toEpochMilli()));
            }
        }
        out.put("sleep", sleep);
        return out;
    }

    private static <T extends androidx.health.connect.client.records.Record> List<T> records(HealthConnectClient hc, Class<T> type, TimeRangeFilter range) throws InterruptedException {
        List<T> all = new java.util.ArrayList<>();
        String token = null;
        for (int i = 0; i < MAX_PAGES; i++) {
            ReadRecordsRequest<T> req = new ReadRecordsRequest<>(JvmClassMappingKt.getKotlinClass(type), range, Collections.<DataOrigin>emptySet(), true, PAGE, token);
            ReadRecordsResponse<T> res = await((k) -> hc.readRecords(req, k));
            all.addAll(res.getRecords());
            token = res.getPageToken();
            if (token == null || token.isEmpty()) break;
        }
        return all;
    }
}
