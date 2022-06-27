
# lnlinks

Serverless payment links for [Core-Lightning](https://github.com/ElementsProject/lightning)

[lnlink.org](http://lnlink.org)

## How it works

* All page data is stored in the URL:

  - nodeid
  - ip
  - authentication rune (invoice, waitinvoice)
  - product name
  - description
  - price
  - form input fields

* When the user clicks buy, it connects to the configured lightning node and calls the `invoice` rpc via the commando plugin (soon to build a CLN built-in). This is considered a "lightning app" since it is serverless and talks to lightning nodes directly.

* A bolt11 invoice is returned with the configured price, and the description is set to the product name, description, and form input fields

* User pays, and page is updated with notification of payment (not done yet! but will use waitinvoice rpc)

## Demo

[Product page](http://lnlink.org/?d=ASED88EIzNU2uFJoQfClxYISu55lhKHrSTCA58HMNPgtrXECMjQuODQuMTUyLjE4Nzo4MzI0AAMy9mAbVmCjk_SvLXMw8DJp_7x0ymhmhgmlKR7ipmND7nk9MjcmbWV0aG9kPWludm9pY2UERGVhdGggU3RhcgAFAAAAZAZBbiBvYmplY3Qgb2YgdW5mYXRob21hYmxlIHBvd2VyAAcM)

The editor (just add `&edit=1` at the end of the url)

[Editor](http://lnlink.org/?d=ASED88EIzNU2uFJoQfClxYISu55lhKHrSTCA58HMNPgtrXECMjQuODQuMTUyLjE4Nzo4MzI0AAMy9mAbVmCjk_SvLXMw8DJp_7x0ymhmhgmlKR7ipmND7nk9MjcmbWV0aG9kPWludm9pY2UERGVhdGggU3RhcgAFAAAAZAZBbiBvYmplY3Qgb2YgdW5mYXRob21hYmxlIHBvd2VyAAcM&edit=1)

