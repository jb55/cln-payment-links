
# cln-payment-links

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

* When the user clicks buy, it connects to the configured lightning node and calls the `invoice` rpc via the commando plugin (soon to build a CLN built-in). This is considered a "lightning app" since it is serverless and talks to lightning nodes directly. `experimental-websocket-port=8324` needs to be set in your config for websockets access.

* A bolt11 invoice is returned with the configured price, and the description is set to the product name, description, and form input fields

* User pays, and page is updated with notification of payment (not done yet! but will use waitinvoice rpc)

## What's next?

You'll need a way to manage your lightning node to view paid invoices. Ideally there would be an iOS and web app that talks directly to your lightning node to do this. [Follow me on twitter](https://twitter.com/jb55) for updates on this.
