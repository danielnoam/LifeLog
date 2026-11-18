### Added
- Investments compares you with the S&P 500: a faint SPY line on each ticker's chart (the S&P 500 button turns it off), and under Holding what the same money would be worth in SPY bought on the same days, with how far ahead or behind you are. The You hold total says the same for everything you bought.
- Today's price while the US market is open: the chart, the list and Home show it (the widget too, from the app's last look) with "As of" and the time, refreshed about every 15 minutes, until the day's close comes in.
- A target can ring at or over its price as well as at or under it, for a price to sell at. The ticker sheet has the choice; the bridge's watch_ticker and update_ticker take `above`.
- Under each ticker's price: when the market closes, or when it next opens.

### Changed
- Closes are asked for once the next one should be out (about 17:30 New York time), not every six hours, so there are no requests on weekends or market holidays and the day's close shows up sooner.
