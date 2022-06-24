async function make_request({nodeid, address, method, rune, params}) {
	const LNSocket = await lnsocket_init()
	const ln = LNSocket()

	ln.genkey()
	await ln.connect_and_init(nodeid, address)

	const {result} = await ln.rpc({ rune, method, params })

	ln.disconnect()
	return result
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

function make_invoice({nodeid, address, rune, description, msatoshi}) {
	return make_request({
		method: "invoice",
		nodeid, address, rune,
		msatoshi: msatoshi,
		label: `lnlink-${new Date().getTime()}`,
		description: description
	})
}

function make_qr() {
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
	qrlink.style.display = "block";
	qrdiv.style.display = "block";
	offerdata.value = invoice.bolt11
	el.style.display = "none";
	tipjar_img.style.display = "none";
}


async function click_make_invoice(el) {
	const note = prompt("Leave a note!", "")

	const invoice = await make_invoice(note)
}

async function copy_tip() {
	const offer = document.querySelector("#offerdata").value.trim();
	try {
		await navigator.clipboard.writeText(offer)
		alert("Invoice copied to clipboard!")
	} catch(err) {
		console.log("clipboard copy error", err)
		document.querySelector("#offerdata").style.display = "block"
	}
}

async function go() {
	/*
	const tipjar_copies = document.querySelectorAll(".tipjar-copy")
	for (const el of tipjar_copies) {
		el.onclick = copy_tip
	}
	*/

	const data = window.location.hash.substr(1)
	const state = {}

	if (data) {
		handle_lnlink(data)
	} else {
		handle_form(state)
	}
}

function handle_lnlink(data)
{
	const decoded = decode_link_data(data)
	console.log(decoded)
	document.querySelector("#content").innerHTML = data
}

function handle_form(state)
{
	const inputs = document.querySelectorAll("#form input")
	for (const input of inputs) {
		input.addEventListener('input', input_changed.bind(null,state))
	}
}

function input_changed(state, ev)
{
	let ok = false
	switch (ev.target.id) {
	case "node_address":
		ok = address_changed(state, ev)
		break
	case "rune":
		ok = rune_changed(state, ev)
		break
	}

	if (ok)
		update_link(state)
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
const NUM_TAGS = 3

function tag_name(tag)
{
	switch (tag) {
	case TAG_NODEID: return 'nodeid'
	case TAG_RUNE: return 'rune'
	case TAG_IP: return 'ip'
	}
	throw new Error(`invalid tag: ${tag}`)
}

function tag_type(tag)
{
	switch (tag) {
	case TAG_NODEID: return 'array'
	case TAG_RUNE: return 'array'
	case TAG_IP: return 'string'
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
		const raw_str = atob(data)
		let buf = new Uint8Array(raw_str.length)
		for (let i = 0; i < raw_str.length; i++) {
			buf[i] = raw_str.charCodeAt(i)
		}
		return parse_link_data(buf)
	} catch(e) {
		console.log(e)
		return null
	}
}


function encode_link_data(state)
{
	let tvs = []
	if (state.nodeid) {
		const b = tagged_array(TAG_NODEID, state.nodeid)
		tvs.push(b)
	}

	if (state.ip) {
		const b = tagged_string(TAG_IP, state.ip)
		tvs.push(b)
	}

	if (state.rune) {
		const runebuf = tagged_array(TAG_RUNE, state.rune)
		tvs.push(runebuf)
	}

	const buf = concat_buffers(tvs)
	return btoa(String.fromCharCode.apply(null, buf));
}

function update_link(state) {
	const dat = encode_link_data(state)
	const el = document.querySelector("#link")
	const link = `http://lnlink.org/#${dat}`

	el.href = link
	el.text = link
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

function rune_changed(state, ev)
{
	const rune_str = ev.target.value
	try {
		const rune = atob(rune_str)
		let buf = new Uint8Array(rune.length)
		for (let i = 0; i < rune.length; i++) {
			buf[i] = rune.charCodeAt(i)
		}

		state.rune = buf
		return true
	} catch {
		return false
	}
}

function address_changed(state, ev)
{
	const address = ev.target.value
	const [nodeid, ip] = address.split("@")
	const raw = hex_decode(nodeid)
	console.log(nodeid,ip)
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

go()
