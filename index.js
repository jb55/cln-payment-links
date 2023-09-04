let STATE

async function go() {
	const state = {}

	const params = get_qs()
	const data = params.get("d")
	const edit = +params.get("edit") === 1

	if (edit) {
		const decoded_state = STATE = decode_link_data(data)
		handle_form(decoded_state)
	} else if (data) {
		await handle_lnlink(data, params)
	} else {
		handle_form(state)
	}
}

const LNSocket_ready = lnsocket_init()

async function make_request(method, auth, params) {
	const LNSocket = await LNSocket_ready
	const ln = LNSocket()

	ln.genkey()
	await ln.connect_and_init(auth.nodeid, auth.address)

	const rune = auth.rune
	const res = await ln.rpc({ rune, method, params })

	ln.disconnect()
	return res
}


function make_invoice(auth, params) {
	// 20m
	params.expiry = params.expiry || (Math.floor(new Date().getTime() / 1000) + 60 * 20)
	return make_request("invoice", auth, params)
}

function get_qs() {
	return (new URL(document.location)).searchParams;
}

async function handle_lnlink(data, params)
{
	const decoded = decode_link_data(data, params)
	const el = document.querySelector("#content") 
	const xr = decoded.xr || await fetch_btc_xr()
	STATE = {data: decoded, xr}
	el.innerHTML = render_lnlink(STATE)
	unhide_content()
}

function slugify(str)
{
	return str.toLowerCase().replace(" ", "-")
}

function make_description({data})
{
	const {fields, description, ordernumber, product} = data
	let base = ""
	if (ordernumber)
		base += `Order ${ordernumber}\n`
	base += `1x ${product}\n${description}`
	if (!fields)
		return base

	return Object.keys(FIELDS_BITS).reduce((desc, name) => {
		const el = document.querySelector(`#${name}_input`)
		const val = el && el.value
		if (val && (FIELDS_BITS[name] & fields))
			desc += `\n${name}: "${val}"`
		return desc
	}, `${base}\n`)
}

function get_product_name(p)
{
	return p || "For Sale!"
}


function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}


async function fetch_local_fallback() {
	const response = await fetch('/rate.txt');
	const data = await response.text();
	return parseFloat(data.trim());
}

async function fetch_btc_xr()
{
	try {
		// can just run a script to update this from anywhere
		const response = await fetch('/rate.txt');
		const data = await response.text();
		return parseFloat(data.trim());
	} catch {
		// oof
		return 30000
	}
}

async function click_pay_button(el)
{
	el.disabled = true
	const {data} = STATE
	const product = get_product_name(data.product)
	const label = `lnlink-${uuidv4()}`

	const description = make_description(STATE)
	const prefix = location.protocol === "https:" ? "wss://" : "ws://"
	const amount_msat = data.price == null ? "any" : (+data.price) * 1000

	try {
		const auth = {
			address: prefix + data.ip,
			nodeid: hex_encode(data.nodeid),
			rune: base64_encode(data.rune),
		}
		const res = await make_invoice(auth, { 
			label, description, amount_msat
		})

		if (!(res && res.result)) {
			el.disabled = false
			show_error(res)
			return
		}

		make_qrcode(res.result)
		const input_form = document.querySelector("#input-form")
		input_form.style.display = "none"

		const wait_res = await wait_for_invoice(auth, label)

		const qr = document.querySelector("#qr-container")

		if (wait_res.error) {
			qr.innerHTML = `
				<h2 class="error">Payment Error!</h2>
				<p class="error">${JSON.stringify(wait_res.error)}</p>
			`
			return
		}

		await spin_animation(qr)
		qr.innerHTML = `
			<img src="check.svg"/>
			<h2 class="success">Payment Success!</h2>
			<p>Invoice ID: ${label}</p>
		`

	} catch (err) {
		el.disabled = false
		show_error(err)
	}

}

async function spin_animation(el) 
{
	el.style.transition = "all ease 0.8s";
	el.style.transform = "rotate(360deg) scale(0.00)";
	await sleep(800)
	el.style.transform = "scale(1.0)";
}

function show_error(err)
{
	err = (err && JSON.stringify(err)) || "An Unknown Error Occurred"
	const el = document.querySelector("#qrcode")
	el.innerHTML = `
	<p>Oh no :( there was a problem. Please try again</p>
	<pre>${err}</pre>
	`
}


function make_qrcode(invoice)
{
	const qrlink = document.querySelector("#qrcode-link")

	const link = "LIGHTNING:" + invoice.bolt11.toUpperCase()
	const qr = new QRCode("qrcode", {
		text: link,
		width: 256,
		height: 256,
		colorDark : "#000000",
		colorLight : "#ffffff",
		correctLevel : QRCode.CorrectLevel.L
	})

	qrlink.href = link
}

function capitalize(name) {
	return name[0].toUpperCase() + name.slice(1)
}

function render_input_field(name) {
	const label = capitalize(name)
	return `
	<div class="form-group">
		<label for="${name}">${label}</label>
		<input class="form-control" id="${name}_input" placeholder="${label}">
	</div>
	`
}

function render_input_form(fields)
{
	if (!fields)
		return ""

	const inputs = Object.keys(FIELDS_BITS).reduce((str, name) => {
		if (fields & FIELDS_BITS[name])
			str += render_input_field(name)
		return str
	}, "")

	return `
	<div id="form">
		${inputs}
	</div>
	`
}

// we could have a provided fiat price that we need to convert to sats,
// or a sats price where we can show the fiat equivalent
//
// In either case, we will just return both
function determine_price(state)
{
	const fiatInCents = +state.data.fiat;
	const btcInUsd = state.xr;
	const satsInUsd = btcInUsd / 100_000_000;

	let fiat = fiatInCents / 100;
	let sats = +state.data.price;

	if (!fiat && sats) {
		fiat = sats * satsInUsd;
	} else if (fiat && !sats) {
		state.data.price = sats = Math.round(fiat / satsInUsd);
	} else if (btcInUsd === 0 || (!fiat && !sats)) {
		fiat = null;
		sats = null;
	}


	return { sats, fiat };
}

function render_lnlink(state)
{

	const data = state.data
	const product = get_product_name(data.product)
	const {sats, fiat} = determine_price(state)
	const ending = sats === 1 ? "sat" : "sats"
	const price_str = sats == null ? "Price: You choose!" : `${format_amount(sats)} ${ending} ($${fiat.toFixed(2)})`

	const img = data.image ? `<img id="product-image" src="${data.image}" />` : ""
	const ordernumber = data.ordernumber ? `<h2>Order ${data.ordernumber}` : ``

	return `
	<div id="card">
	<span class="btcprice">
		BTCUSD ${state.xr}<br/>
		<a class="light" href="${window.location}&edit=1">edit</a>
	</span>
	${ordernumber}
	<h2>${product}</h2>
	  <p>${data.description}</p>
	  <h1>${price_str}</h1>
	  ${img}

	  <div id="input-form">
		  ${render_input_form(data.fields)}

		  <button id="paybtn" type="button" class="btn btn-primary btn-large" onclick="click_pay_button(this)">Pay</button>
	  </div>

	  <div id="qr-container">
		  <a id="qrcode-link" href="#">
			  <div id="qrcode">
			  </div>
		  </a>
	  </div>
	</div>
	`
}

function update_fields_checkboxes(fields)
{
	if (fields === 0)
		return

	const keys = Object.keys(FIELDS_BITS)
	for (const field of keys) {
		document.querySelector("#"+field).checked = !!(fields & FIELDS_BITS[field])
	}
}

function update_form_from_state(state)
{
	const state_keys = Object.keys(state)
	for (const key of state_keys) {
		switch (key) {
		case "ip":
		case "nodeid":
			var el = document.getElementById("ip")
			el.value = hex_encode(state.nodeid) + "@" + state.ip
			break
		case "rune":
			var el = document.getElementById("rune")
			el.value = base64_encode(state.rune)
			break
		case "fields":
			update_fields_checkboxes(state.fields || 0)
			break
		default:
			var el = document.getElementById(key)
			if (!el)
				throw new Error(`no el for state key ${key}`)
			if (key === "fiat") {
				el.value = state[key] / 100
			} else {
				el.value = state[key]
			}
		}
	}

	if (state_keys.length > 0)
		update_link(state)
}

function unhide_content() {
	document.querySelector("#content").style.display = "block"
}

function handle_form(state)
{
	unhide_content()
	update_form_from_state(state)

	const inputs = document.querySelectorAll("#form input,textarea")
	for (const input of inputs) {
		input.addEventListener('input', input_changed.bind(null,state))
	}
}

const FIELDS_BITS = {
	email: 1 << 0,
	address: 1 << 1,
	name: 1 << 2,
	phone: 1 << 3,
	nostrAddress: 1 << 4,
}

function fields_changed(state, field, checked)
{
	state.fields = state.fields || 0
	const bit = FIELDS_BITS[field]

	if (checked)
		state.fields |= bit
	else
		state.fields &= ~bit
}


function input_changed(state, ev)
{
	let ok = false
	switch (ev.target.id) {
	case "ip":
		ok = address_changed(state, ev.target.value)
		break
	case "rune":
		ok = rune_changed(state, ev.target.value)
		break
	case "fiat":
		state.fiat = parseFloat(ev.target.value) * 100
		ok = true
		break;
	default:
		// fields
		if (Object.keys(FIELDS_BITS).some(x => x === ev.target.id)) {
			fields_changed(state, ev.target.id, ev.target.checked)
			ok = true
		}
		state[ev.target.id] = ev.target.value
		ok = true
	}

	if (ok)
		update_link(state)
}

function tagged_u8(tag, data)
{
	const b = new Uint8Array(2)
	b[0] = tag
	b[1] = data
	return b
}

function tagged_u32(tag, num)
{
	const b = new Uint8Array(5)
	const view = new DataView(b.buffer)
	b[0] = tag
	view.setUint32(1, num)
	return b
}

function tagged_array(tag, arr)
{
	const len = arr.byteLength + 2
	const b = new Uint8Array(len)
	b[0] = tag
	if (len > 0xFF)
		throw new Error("too big!")
	b[1] = arr.byteLength
	for (let i = 0; i < arr.byteLength; i++) {
		b[i+2] = arr[i]
	}
	return b
}

function tagged_string(tag, str)
{
	const b = new Uint8Array(str.length + 2)
	b[0] = tag
	for (let i = 0; i < str.length; i++) {
		b[i+1] = str.charCodeAt(i)
	}
	b[b.byteLength-1] = 0
	return b
}

const TAG_NODEID = 1
const TAG_IP = 2
const TAG_RUNE = 3
const TAG_PRODUCT = 4
const TAG_PRICE = 5
const TAG_DESCRIPTION = 6
const TAG_FIELDS = 7
const TAG_IMAGE = 8
const TAG_ORDERNUMBER = 9
const TAG_FIAT = 10
const NUM_TAGS = 10
const ALL_TAGS = (function() {
	let a = []
	for (let i = 1; i <= NUM_TAGS; i++) {
		a.push(i)
	}
	return a
})()

function tag_name(tag)
{
	switch (tag) {
	case TAG_NODEID: return 'nodeid'
	case TAG_IP: return 'ip'
	case TAG_RUNE: return 'rune'
	case TAG_PRODUCT: return 'product'
	case TAG_PRICE: return 'price'
	case TAG_FIAT: return 'fiat'
	case TAG_DESCRIPTION: return 'description'
	case TAG_FIELDS: return 'fields'
	case TAG_IMAGE: return 'image'
	case TAG_ORDERNUMBER: return 'ordernumber'
	}
	throw new Error(`invalid tag: ${tag}`)
}

function tag_name_to_id(name)
{
	switch (name) {
	case 'nodeid': return TAG_NODEID
	case 'ip': return TAG_IP
	case 'rune': return TAG_RUNE
	case 'product': return TAG_PRODUCT
	case 'price': return TAG_PRICE
	case 'fiat': return TAG_FIAT
	case 'description': return TAG_DESCRIPTION
	case 'fields': return TAG_FIELDS
	case 'image': return TAG_IMAGE
	case 'ordernumber': return TAG_ORDERNUMBER
	}
	return null
}

function tag_type(tag)
{
	switch (tag) {
	case TAG_NODEID: return 'array'
	case TAG_IP: return 'string'
	case TAG_RUNE: return 'array'
	case TAG_PRODUCT: return 'string'
	case TAG_PRICE: return 'u32'
	case TAG_DESCRIPTION: return 'string'
	case TAG_FIELDS: return 'u8'
	case TAG_IMAGE: return 'string'
	case TAG_ORDERNUMBER: return 'string'
	case TAG_FIAT: return 'u32'
	}
	throw new Error(`invalid tag: ${tag}`)
}

function parse_byte(state)
{
	if (state.pos > state.buf.byteLength)
		return null
	return state.buf[state.pos++]
}

function parse_tag(state)
{
	const tag = parse_byte(state)
	if (!tag) return null
	if (tag >= TAG_NODEID && tag <= NUM_TAGS)
		return tag
	return null
}

function parse_u32_packet(state)
{
	let view = new DataView(state.buf.buffer)
	const u32 = view.getUint32(state.pos)
	state.pos += 4
	return u32
}

function parse_array_packet(state)
{
	const len = parse_byte(state)
	if (len === null)
		return null
	let buf = new Uint8Array(len)
	for (let i = 0; i < len; i++) {
		const b = parse_byte(state)
		if (b === null)
			return null
		buf[i] = b
	}
	return buf
}

function parse_string_packet(state)
{
	let str = ""
	while (state.pos < state.buf.byteLength) {
		const b = parse_byte(state)
		if (b === 0)
			return str
		str += String.fromCharCode(b)
	}
	return null
}

function hex_char(val)
{
	if (val < 10)
		return String.fromCharCode(48 + val)
	if (val < 16)
		return String.fromCharCode(97 + val - 10)
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function wait_for_invoice(auth, label) {
	while (true) {
		try {
			const res = await make_request("waitinvoice", auth, {label})
			return res
		} catch {
			console.log("disconnected... trying waitinvoice again")
		}
	}
}


function hex_encode(buf)
{
	str = ""
	for (let i = 0; i < buf.byteLength; i++) {
		const c = buf[i]
		str += hex_char(c >> 4)
		str += hex_char(c & 0xF)
	}
	return str
}

function post_process_packet(tag, pkt)
{
	switch (tag) {
	case TAG_NODEID: return hex_encode(pkt)
	case TAG_RUNE:   return base64_encode(pkt)
	case TAG_IP:     return "ws://" + pkt
	}
	return pkt
}

function parse_link_packet(state)
{
	const tag = parse_tag(state)
	if (!tag)
		return false

	const ttype = tag_type(tag)
	let pkt
	switch (ttype) {
	case 'array':
		if (!(pkt = parse_array_packet(state)))
			return false
		break
	case 'u32':
		if (!(pkt = parse_u32_packet(state)))
			return false
		break
	case 'u8':
		if (null === (pkt = parse_byte(state)))
			return false
		break
	case 'string':
		if (!(pkt = parse_string_packet(state)))
			return false
		break
	default:
		throw new Error(`invalid tag type: ${ttype}`)
	}

	state.data[tag_name(tag)] = pkt
	return true
}

function parse_link_data(buf, params)
{
	let state = {pos:0, buf, data:{}}
	while (state.pos < buf.byteLength) {
		if (!parse_link_packet(state))
			return null
	}

	// fill in querystring params for dynamic forms
	if (params) {
		for (const [key, value] of params) {
			if (tag_name_to_id(key) !== 0) {
				state.data[key] = value
			}
		}
	}

	return state.data
}

function decode_link_data(data, params)
{
	try {
		const buf = base64_decode(data)
		return parse_link_data(buf, params)
	} catch(e) {
		console.log(e)
		return null
	}
}


function encode_link_data(state)
{
	const tvs = ALL_TAGS.reduce((acc, tag) => {
		const name = tag_name(tag)
		const val = state[name]
		if (val) {
			let tv
			switch (tag_type(tag)) {
			case 'string':
				tv = tagged_string(tag, val)
				break
			case 'array':
				tv = tagged_array(tag, val)
				break
			case 'u32':
				tv = tagged_u32(tag, +val)
				break
			case 'u8':
				tv = tagged_u8(tag, val)
				break
			}
			acc.push(tv)
		}
		return acc
	}, []);

	const buf = concat_buffers(tvs)
	return base64_encode(buf)
}

function update_link(state) {
	const dat = encode_link_data(state)
	const el = document.querySelector("#link")
	const edit_el = document.querySelector("#edit-link")
	const host = window.location.host
	const scheme = window.location.protocol
	const url = new URL(document.location)
	const params = url.searchParams
	const edit = +params.get("edit") === 1 ? `&edit=1` : ""

	const link = `${scheme}//${host}${url.pathname}?d=${dat}`
	const edit_link = `${link}&edit=1`

	el.href = link
	el.text = link

	edit_el.href = edit_link
	edit_el.text = edit_link

	window.history.replaceState({}, '', link + edit)
}

function str_buffer(str) {
	return Uint8Array.from(Array.from(text).map(letter => letter.charCodeAt(0)));
}

function concat_buffers(bufs) {
	const size = bufs.reduce((n, buf) => {
		return n + buf.byteLength
	}, 0);

	let big = new Uint8Array(size)

	let i = 0;
	for (const buf of bufs) {
		for (let j = 0; j < buf.byteLength; j++) {
			big[i++] = buf[j]
		}
	}

	return big
}

function base64_encode(buf) {
	return btoa(String.fromCharCode.apply(null, buf))
		.replace(/[+]/g, '-')
		.replace(/[/]/g, '_')
}

function base64_decode(str) {
	const decoded = atob(str.replace(/-/g, '+').replace(/_/g, '/'))
	let buf = new Uint8Array(decoded.length)
	for (let i = 0; i < decoded.length; i++) {
		buf[i] = decoded.charCodeAt(i)
	}
	return buf
}


function rune_changed(state, rune_str)
{
	try {
		state.rune = base64_decode(rune_str)
		return true
	} catch(e) {
		console.log(e)
		return false
	}
}

function address_changed(state, address)
{
	const [nodeid, ip] = address.split("@")
	const raw = hex_decode(nodeid)
	if (!raw)
		return false
	state.nodeid = raw
	state.ip = ip
	return true
}

function format_amount(amt)
{
	return amt.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function char_to_hex(cstr) {
	const c = cstr.charCodeAt(0)
	// c >= 0 && c <= 9
	if (c >= 48 && c <= 57) {
		return c - 48;
	}
	// c >= a && c <= f
 	if (c >= 97 && c <= 102) {
		return c - 97 + 10;
	}
	// c >= A && c <= F
 	if (c >= 65 && c <= 70) {
		return c - 65 + 10;
	}
	return -1;
}


function hex_decode(str, buflen)
{
	let bufsize = buflen || 33
	let c1, c2
	let i = 0
	let j = 0
	let buf = new Uint8Array(bufsize)
	let slen = str.length
	while (slen > 1) {
		if (-1==(c1 = char_to_hex(str[j])) || -1==(c2 = char_to_hex(str[j+1])))
			return null;
		if (!bufsize)
			return null;
		j += 2
		slen -= 2
		buf[i++] = (c1 << 4) | c2
		bufsize--;
	}

	return buf
}

go()
