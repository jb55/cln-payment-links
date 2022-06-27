let STATE

async function go() {
	const state = {}

	const params = get_qs()
	const data = params.get("d");
	const edit = +params.get("edit") === 1;

	if (edit) {
		const decoded_state = STATE = decode_link_data(data)
		handle_form(decoded_state)
	} else if (data) {
		handle_lnlink(data)
	} else {
		handle_form(state)
	}
}

async function make_request({nodeid, address, method, rune, params}) {
	const LNSocket = await lnsocket_init()
	const ln = LNSocket()

	ln.genkey()
	await ln.connect_and_init(nodeid, address)

	const res = await ln.rpc({ rune, method, params })

	ln.disconnect()
	return res
}


function make_invoice({nodeid, label, address, rune, description, msatoshi}) {
	return make_request({
		method: "invoice",
		nodeid, address, rune, 
		params: { label, msatoshi, description }
	})
}

function get_qs() {
	return (new URL(document.location)).searchParams;
}

function handle_lnlink(data)
{
	const decoded = decode_link_data(data)
	const el = document.querySelector("#content") 
	STATE = {data: decoded}
	el.innerHTML = render_lnlink(STATE)
	unhide_content()
}

function slugify(str)
{
	return str.toLowerCase().replace(" ", "-")
}

function make_description({data})
{
	const {fields, description} = data
	if (!fields) {
		return description
	}

	return Object.keys(FIELDS_BITS).reduce((desc, name) => {
		const el = document.querySelector(`#${name}_input`)
		const val = el && el.value
		if (val && (FIELDS_BITS[name] & fields))
			desc += `\n${name}: "${val}"`
		return desc
	}, `${description}\n`)
}

async function click_buy_button()
{
	const {data} = STATE
	const label = `lnlink-${slugify(data.product)}-${new Date().getTime()}`

	const description = make_description(STATE)

	const res = await make_invoice({
		nodeid: hex_encode(data.nodeid),
		label: label,
		rune: base64_encode(data.rune),
		description: description,
		address: "ws://" + data.ip,
		msatoshi: (+data.price) * 1000,
	})

	if (!(res && res.result)) {
		show_error(res)
		return
	}

	make_qrcode(res.result)
}

function show_error(err)
{
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

function render_lnlink(state)
{

	const data = state.data
	const product = data.product || "For Sale!"
	const sats = +data.price
	const ending = sats === 1 ? "sat" : "sats"
	const price = format_amount(+data.price) + " " + ending

	return `
	<div id="card">
	<h3>${data.product}</h3>
	  <p>${data.description}</p>
	  <h1>${price}</h1>

          ${render_input_form(data.fields)}

	  <button type="button" class="btn btn-primary" onclick="click_buy_button()">Buy</button>

	  <a id="qrcode-link" href="#">
		  <div id="qrcode">
		  </div>
	  </a>
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
			el.value = state[key]
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
const NUM_TAGS = 7
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
	case TAG_DESCRIPTION: return 'description'
	case TAG_FIELDS: return 'fields'
	}
	throw new Error(`invalid tag: ${tag}`)
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

function parse_link_data(buf)
{
	let state = {pos:0, buf, data:{}}
	while (state.pos < buf.byteLength) {
		if (!parse_link_packet(state))
			return null
	}
	return state.data
}

function decode_link_data(data)
{
	try {
		const buf = base64_decode(data)
		return parse_link_data(buf)
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
	const host = window.location.host
	const scheme = window.location.protocol
	const params = get_qs()
	const edit = +params.get("edit") === 1 ? `&edit=1` : ""
	const link = `${scheme}//${host}/?d=${dat}`

	el.href = link
	el.text = link

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

function time_delta(current, previous) {
    var msPerMinute = 60 * 1000;
    var msPerHour = msPerMinute * 60;
    var msPerDay = msPerHour * 24;
    var msPerMonth = msPerDay * 30;
    var msPerYear = msPerDay * 365;

    var elapsed = current - previous;

    if (elapsed < msPerMinute) {
         return Math.round(elapsed/1000) + ' seconds ago';   
    } else if (elapsed < msPerHour) {
         return Math.round(elapsed/msPerMinute) + ' minutes ago';   
    } else if (elapsed < msPerDay ) {
         return Math.round(elapsed/msPerHour ) + ' hours ago';   
    } else if (elapsed < msPerMonth) {
        return Math.round(elapsed/msPerDay) + ' days ago';   
    } else if (elapsed < msPerYear) {
        return Math.round(elapsed/msPerMonth) + ' months ago';   
    } else {
        return Math.round(elapsed/msPerYear ) + ' years ago';   
    }
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
