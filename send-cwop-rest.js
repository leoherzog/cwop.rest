import { connect } from 'cloudflare:sockets';
const cache = caches.default;
const host_domain_name = 'send.cwop.rest'
const host_url = 'https://' + host_domain_name;
const packet_software_name = 'cwop.rest 1.1';
const packet_sender_code = 'eREST';

export default {
  async fetch(request) {
    return handleRequest(request);
  }
}

export async function handleRequest(request) {

  let packet, validationCode, manuallySpecifiedServer;

  const url = new URL(request.url); // used for params and host detection
  
  if (request.method === 'GET') { // if they're using url params

    if (url.searchParams.has('packet')) { // default to provided packet, if any
      packet = url.searchParams.get('packet');
      packet = decodeURIComponent(packet);
    } else if (url.searchParams.has('id') &&  // otherwise, check for params needed to build our own
               url.searchParams.has('lat') &&
               url.searchParams.has('long') &&
               url.searchParams.has('time') &&
               url.searchParams.has('tempf')) {
      packet = buildPacket(url);
    } else { // we need either a provided packet or required readings to make our own
      return new Response('Missing required packet or readings parameters', { "status": 422 });
    }

    validationCode = url.searchParams.get('validation');
    manuallySpecifiedServer = url.searchParams.get('server');

  } else if (request.method === 'POST') { // must be POST'ing JSON

    let body;
    try {
      body = await request.json();
    }
    catch(e) {
      return new Response('Invalid JSON in payload', { "status": 400 });
    }

    if (body.packet) {  // default to provided packet, if any
      packet = body.packet.replace(/^\s+/, '').replace(/[\r\n]+$/, ''); // keep spec-significant trailing spaces, drop only the line terminator
    } else if (body.time && body.id && body.lat && body.long && body.tempf != null) {  // otherwise, check for required params to build our own
      packet = buildPacket(body);
    } else {
      return new Response('Missing required packet or readings parameters in payload', { "status": 422 });
    }

    validationCode = body.validation;
    manuallySpecifiedServer = body.server;
    
  } else {
    return new Response('Invalid request method', { "status": 405 });  // HTTP 405 Method Not Allowed
  }

  console.log('Packet received: ' + packet);

  let validation = validatePacket(packet);
  if (validation !== true) {
    return validation;
  }

  // possibly valid! has this id sent recently?

  const id = packet.split('>')[0];
  const cacheKey = `${host_url}/id=${id}`;
  const lastSentTimeResponse = await cache.match(cacheKey);
  if (lastSentTimeResponse) {
    const lastSentTime = await lastSentTimeResponse.text();
    if ((Date.now() - Number(lastSentTime)) < 290 * 1000) { // 5 minute cooldown w/ 10 second grace
      return new Response('Too many requests for ' + id, { "status": 429 }); // HTTP 429 Too Many Requests
    }
  }

  await cache.put(cacheKey, new Response(Date.now().toString()));

  let server = 'cwop.aprs.net';
  if (validationCode) server = 'rotate.aprs.net'; // http://www.wxqa.com/servers2use.html
  if (manuallySpecifiedServer) server = manuallySpecifiedServer;

  if (url.host !== host_domain_name) { // for testing
    return new Response('APRS packet "' + packet + '" would have been sent to ' + server, { "status": 200 });
  }
  
  try {
    await sendPacket(packet, server, 14580, validationCode);
  }
  catch(e) {
    await sendPacket(packet, server, 23, validationCode);
  }

  let msg = `APRS packet '${packet}' sent to '${server}'`;
  console.log(msg);

  return new Response(msg, { "status": 200 });

}

function buildPacket(observation) {

  let id, lat, long, time, tempf, windspeedmph, windgustmph, winddir, rainhour, rainsincemidnight, rainlast24hr, pressure, humidity, solarradiation;

  if (observation instanceof URL) {
    if (observation.searchParams.get('id')) id = observation.searchParams.get('id');
    if (observation.searchParams.get('lat')) lat = Number(observation.searchParams.get('lat'));
    if (observation.searchParams.get('long')) long = Number(observation.searchParams.get('long'));
    if (observation.searchParams.get('time')) time = new Date(Number(observation.searchParams.get('time')) ? Number(observation.searchParams.get('time')) : observation.searchParams.get('time'));
    if (observation.searchParams.get('tempf')) tempf = Number(observation.searchParams.get('tempf'));
    if (observation.searchParams.get('windspeedmph')) windspeedmph = Number(observation.searchParams.get('windspeedmph'));
    if (observation.searchParams.get('windgustmph')) windgustmph = Number(observation.searchParams.get('windgustmph'));
    if (observation.searchParams.get('winddir')) winddir = Number(observation.searchParams.get('winddir'));
    if (observation.searchParams.get('rainin')) rainhour = Number(observation.searchParams.get('rainin'));
    if (observation.searchParams.get('dailyrainin')) rainsincemidnight = Number(observation.searchParams.get('dailyrainin'));
    if (observation.searchParams.get('last24hrrainin')) rainlast24hr = Number(observation.searchParams.get('last24hrrainin'));
    if (observation.searchParams.get('baromin')) pressure = Number(observation.searchParams.get('baromin'));
    if (observation.searchParams.get('pressure')) pressure = Number(observation.searchParams.get('pressure'));
    if (observation.searchParams.get('humidity')) humidity = Number(observation.searchParams.get('humidity'));
    if (observation.searchParams.get('solarradiation')) solarradiation = Number(observation.searchParams.get('solarradiation'));
  } else {
    if (observation.id) id = observation.id;
    if (observation.lat) lat = Number(observation.lat);
    if (observation.long) long = Number(observation.long);
    if (observation.time) time = new Date(observation.time);
    if (observation.tempf) tempf = Number(observation.tempf);
    if (observation.windspeedmph) windspeedmph = Number(observation.windspeedmph);
    if (observation.windgustmph) windgustmph = Number(observation.windgustmph);
    if (observation.winddir) winddir = Number(observation.winddir);
    if (observation.rainin) rainhour = Number(observation.rainin);
    if (observation.dailyrainin) rainsincemidnight = Number(observation.dailyrainin);
    if (observation.last24hrrainin) rainlast24hr = Number(observation.last24hrrainin);
    if (observation.baromin) pressure = Number(observation.baromin);
    if (observation.pressure) pressure = Number(observation.pressure);
    if (observation.humidity) humidity = Number(observation.humidity);
    if (observation.solarradiation) solarradiation = Number(observation.solarradiation);
  }

  let packet = id + '>APREST,TCPIP*:@';

  packet += time.getUTCDate().toString().padStart(2, '0') +
            time.getUTCHours().toString().padStart(2, '0') +
            time.getUTCMinutes().toString().padStart(2, '0');
  
  if (lat < 0) {
    lat = Math.abs(lat);
    lat = Math.floor(lat).toString().padStart(2, '0') + (Math.floor(60 * parseFloat(lat % 1)*100)/100).toFixed(2).toString().padStart(5, '0') + 'S';
  } else {
    lat = Math.floor(lat).toString().padStart(2, '0') + (Math.floor(60 * parseFloat(lat % 1)*100)/100).toFixed(2).toString().padStart(5, '0') + 'N';
  }
  if (long < 0) {
    long = Math.abs(long);
    long = Math.floor(long).toString().padStart(3, '0') + (Math.floor(60 * parseFloat(long % 1)*100)/100).toFixed(2).toString().padStart(5, '0') + 'W';
  } else {
    long = Math.floor(long).toString().padStart(3, '0') + (Math.floor(60 * parseFloat(long % 1)*100)/100).toFixed(2).toString().padStart(5, '0') + 'E';
  }
  packet += 'z' + lat + '/' + long;

  packet += '_' + (winddir != null ? (Math.round(winddir) === 0 ? 360 : Math.round(winddir)).toString().padStart(3, '0') : '...'); // 001-360; 000 is reserved for "unknown"

  packet += '/' + (windspeedmph != null ? Math.min(999, Math.round(windspeedmph)) : '...').toString().padStart(3, '0');

  packet += 'g' + (windgustmph != null ? Math.min(999, Math.round(windgustmph)) : '...').toString().padStart(3, '0');

  if (tempf != null) {
    if (tempf >= 0) {
      packet += 't' + Math.min(999, Math.round(tempf)).toString().padStart(3, '0');
    } else {
      packet += 't' + '-' + Math.min(99, Math.abs(Math.round(tempf))).toString().padStart(2, '0');
    }
  } else {
    packet += 't...';
  }
  
  // optional readings
  if (rainhour != null) {
    packet += 'r' + Math.min(999, Math.round(rainhour * 100)).toString().padStart(3, '0');
  }
  if (rainsincemidnight != null) {
    packet += 'P' + Math.min(999, Math.round(rainsincemidnight * 100)).toString().padStart(3, '0');
  }
  if (rainlast24hr != null) {
    packet += 'p' + Math.min(999, Math.round(rainlast24hr * 100)).toString().padStart(3, '0');
  }
  if (humidity != null) {
    let h = Math.min(100, Math.max(1, Math.round(humidity))); // clamp to 1-100; spec encodes 100% as "00"
    packet += 'h' + (h === 100 ? '00' : h.toString().padStart(2, '0'));
  }
  if (pressure != null) { // "altimeter" (QNH) format, in tenths of millibars
    packet += 'b' + Math.min(99999, Math.round(pressure * 10)).toString().padStart(5, '0');
  }
  if (solarradiation != null) {
    if (solarradiation >= 1000) {
      packet += 'l' + (Math.min(1999, Math.round(solarradiation)) - 1000).toString().padStart(3, '0');
    } else {
      packet += 'L' + Math.min(999, Math.round(solarradiation)).toString().padStart(3, '0');
    }
  }

  packet += packet_sender_code;

  return packet;

}

function validatePacket(packet) {

  // a few basic sanity checks; 53 is a heuristic floor derived from our fixed header plus
  // the mandatory timestamp/position/wind/temp fields, not a spec-defined minimum
  if (!packet || typeof packet !== 'string' || packet.length < 53) {
    return new Response('Invalid or missing packet', { "status": 400 }); // HTTP 400 Bad Request
  }

  let header = packet.split('>')[0];
  if (header !== header.toUpperCase()) {
    return new Response('Packet header must be all uppercase', { "status": 422 }); // HTTP 422 Unprocessable Content
  }

  const atIdx = packet.indexOf('@'); // timestamp marker
  const zIdx = packet.indexOf('z', atIdx); // date-time terminator
  const uIdx = packet.indexOf('_', zIdx); // underscore before wind dir
  if (atIdx < 0 || zIdx < 0 || uIdx < 0) {
    return new Response('Malformed packet (missing @, z or _)', { "status": 422 }); // HTTP 422 Unprocessable Content
  }

  const timePattern = /^(0[1-9]|[12][0-9]|3[01])([01][0-9]|2[0-3])[0-5][0-9]$/;
  let time = packet.substring(packet.indexOf('@') + 1, packet.lastIndexOf('z'));
  if (!timePattern.test(time)) {
    return new Response('Invalid time in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }

  // check if timestamp is within last 5 minutes
  let day = parseInt(time.substring(0,2));
  let hour = parseInt(time.substring(2,4));
  let minute = parseInt(time.substring(4,6));

  let now = new Date();

  // try current month first
  let packetTimestamp = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    day,
    hour,
    minute,
    0,
    0
  ));

  // if timestamp is in the future (beyond our 5-minute tolerance window),
  // it must be from the previous month
  if (packetTimestamp.getTime() - now.getTime() > 5 * 60 * 1000) {
    packetTimestamp = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - 1,  // previous month
      day,
      hour,
      minute,
      0,
      0
    ));
  }

  // now check if within 5-minute window
  if (now.getTime() - packetTimestamp.getTime() > 5 * 60 * 1000) {
    return new Response('Timestamp in packet is not within last 5 minutes', { "status": 422 }); // HTTP 422 Unprocessable Content
  }
  
  // check latlong — this CWOP feed accepts only uncompressed, full-precision coordinates;
  // spec-legal compressed positions and position-ambiguity spaces are intentionally not supported
  const latLongPattern = /(\d{2})(\d{2})\.\d{2}[NS]\/(\d{3})(\d{2})\.\d{2}[EW]/;
  let latlong = packet.substring(packet.indexOf('z') + 1, packet.lastIndexOf('_'));
  let latlongmatch = latlong.match(latLongPattern);
  if (!latlongmatch) {
    return new Response('Unsupported or invalid location data in packet (expected uncompressed ddmm.hhN/dddmm.hhW)', { "status": 422 }); // HTTP 422 Unprocessable Content
  }
  
  let latDegrees = parseInt(latlongmatch[1]);
  let latMinutes = parseInt(latlongmatch[2]);
  let lonDegrees = parseInt(latlongmatch[3]);
  let lonMinutes = parseInt(latlongmatch[4]);
  let latitude = latDegrees + latMinutes / 60;
  let longitude = lonDegrees + lonMinutes / 60;
  if (latMinutes > 59 || lonMinutes > 59) {
    return new Response('Invalid coordinate minutes in packet', { "status": 422 }); // minutes are 00-59
  }
  if (latitude < -90 || latitude > 90) {
    return new Response('Invalid latitude in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }
  if (longitude < -180 || longitude > 180) {
    return new Response('Invalid longitude in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }

  // temperature is mandatory (spec: timestamp, wind dir/speed/gust and temperature must always be present)
  let tIdx = packet.indexOf('t', uIdx); // first 't' after winds
  if (tIdx === -1 || tIdx + 4 > packet.length) {
    return new Response('Missing temperature in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }
  let tStr = packet.substring(tIdx + 1, tIdx + 4); // '...', '075', '-12'
  if (tStr !== '...') {
    if (!/^-?\d{2,3}$/.test(tStr)) {
      return new Response('Invalid temperature', { status: 422 });
    }
    let tVal = Number(tStr);
    if (tVal < -99 || tVal > 999) {
      return new Response('Temperature out of range', { status: 422 });
    }
  }

  // wind dir / speed / gust live in fixed positions after the symbol code: _ddd/sssgNNN
  if (packet[uIdx + 4] !== '/' || packet[uIdx + 8] !== 'g') {
    return new Response('Malformed wind data in packet', { status: 422 }); // HTTP 422 Unprocessable Content
  }
  let windDirStr = packet.substring(uIdx + 1, uIdx + 4); // ddd, ... or spaces
  let windSpdStr = packet.substring(uIdx + 5, uIdx + 8); // ddd, ... or spaces
  let windGstStr = packet.substring(uIdx + 9, uIdx + 12); // ddd, ... or spaces

  // missing values may be expressed as dots or spaces
  const noData = s => s === '...' || s === '   ';

  // wind direction 0–360 (000 = unknown), or the no-data sentinel
  if (!noData(windDirStr) && (!/^\d{3}$/.test(windDirStr) || Number(windDirStr) > 360)) {
    return new Response('Invalid wind direction in packet', { status: 422 });
  }

  // wind speed & gust 0–999, or the no-data sentinel
  const badWind = s => !noData(s) && (!/^\d{3}$/.test(s) || Number(s) > 999);
  if (badWind(windSpdStr) || badWind(windGstStr)) {
    return new Response('Invalid wind speed/gust in packet', { status: 422 });
  }

  // Optional tokens are matched with their exact digit counts and only within the
  // weather data, so the trailing software/unit code (e.g. ...b09900wRSW, where the
  // unit may itself contain r/p/h/b) can't be mistaken for a reading.
  const wx = packet.slice(uIdx);

  // humidity token, if present, must encode 0–100 (00 = 100%)
  let hMatch = wx.match(/h(\d{2})/);
  if (hMatch && Number(hMatch[1]) > 100) {
    return new Response('Invalid humidity in packet', { status: 422 });
  }

  // barometer token, if present, is 5 digits (tenths of mb)
  let bMatch = wx.match(/b(\d{5})/);
  if (bMatch && Number(bMatch[1]) > 19999) {
    return new Response('Invalid barometer token', { status: 422 });
  }

  // solar-radiation token L### (0–999 W/m²) or l### (≥1000); matched only within the
  // weather data so an l/L in the callsign or comment can't be misread as a reading
  let lMatch = wx.match(/[lL](\d{3})/);
  if (lMatch && Number(lMatch[1]) > 999) {
    return new Response('Invalid solar radiation in packet', { status: 422 });
  }

  return true;

}

export async function sendPacket(packet, server, port, validationCode = '-1') {

  console.log('Opening connection to ' + server + ':' + port);

  const socket = connect({ "hostname": server, "port": port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  
  // wait for server's initial message - http://www.wxqa.com/faq.html
  let initialMessage = await reader.read();
  console.log('Received from server: ', new TextDecoder().decode(initialMessage.value));

  // send login line
  const id = packet.split('>')[0];
  const loginLine = 'user ' + id + ' pass ' + validationCode + ' vers ' + packet_software_name + '\r\n';
  console.log('Sending to server: ', loginLine);
  let encoded = encoder.encode(loginLine);
  await writer.write(encoded);

  // Wait for server's acknowledgement
  let { value, done } = await reader.read();
  console.log('Received from server: ', new TextDecoder().decode(value));

  // Send packet
  console.log('Sending to server: ', packet);
  encoded = encoder.encode(packet + '\r\n');
  console.log('Encoded packet bytes: ', Array.from(encoded));
  await writer.write(encoded);

  // close the write side
  writer.close();

  // drain everything the server says before disconnecting
  let lastChunk = value; // start with the ACK we already got
  while (true) {
    let { value: chunk, done: rdDone } = await reader.read();
    if (rdDone) break; // socket closed by server
    console.log('Received from server: ', new TextDecoder().decode(chunk));
    lastChunk = chunk; // remember the most recent text
  }
  reader.releaseLock();
  let serverResponse = new TextDecoder().decode(lastChunk);
  console.log('Received from server: ', serverResponse);

  console.log('Closing connection to ' + server + ':' + port);
  
  return new Response(serverResponse, { "headers": { "Content-Type": "text/plain" } });

}