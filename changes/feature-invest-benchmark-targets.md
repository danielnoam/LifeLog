### Added
- Investments compares you with the S&P 500: a faint SPY line on each ticker's chart (the S&P 500 button turns it off), and under Holding what the same money would be worth in SPY bought on the same days, with how far ahead or behind you are. The You hold total says the same for everything you bought.
- Today's price while the US market is open: the chart, the list and Home show it (the widget too, from the app's last look) with "As of" and the time, refreshed about every 15 minutes, until the day's close comes in.
- A target can ring at or over its price as well as at or under it, for a price to sell at. The ticker sheet has the choice; the bridge's watch_ticker and update_ticker take `above`.
- Under each ticker's price: when the market closes, or when it next opens.
- Holding counts cash dividends: the dividends paid on the shares you held the day before each (before tax), worked out from Tiingo's prices, and an "All in" figure with what's held, what sales brought and the dividends against everything paid.
- The yearly return under Holding and You hold, once your first buy is a year old: money-weighted, so a buy made last month counts for a month.
- A fee on a buy or a sale: it adds to what a buy cost and comes off what a sale brought in. The buy sheet has the field; the bridge's add_buy and update_buy take `fee`.
- Worth over time under You hold: what everything you held was worth each day of the range, beside the money you'd put in by then. The bridge's new lifelog_holdings_worth gives it month by month.

### Changed
- The S&P 500 comparison counts your dividends and fees too.
- Closes are asked for once the next one should be out (about 17:30 New York time), not every six hours, so there are no requests on weekends or market holidays and the day's close shows up sooner.

### Fixed
- A stock split no longer reads as a loss: the shares you bought before it are multiplied (a 4-for-1 turns 10 shares into 40 at the same cost), and a sale of the new shares isn't refused as more than you held. The app asks Tiingo for each ticker's full history once more, at its next close, to learn its splits and dividends.
- A buy on a past day fills in the price as it was that day, not the price adjusted for later splits and dividends.
