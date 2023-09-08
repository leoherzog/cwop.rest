import { connect } from 'cloudflare:sockets';
const cache = caches.default;

export default {
  async fetch(request) {
    return handleRequest(request);
  }
}

// incoming request
export async function handleRequest(request) {

  let packet, validationCode, manuallySpecifiedServer;

  const url = new URL(request.url); // used for params and host detection
  
  if (request.method === 'GET') { // if they're using url params

    if (url.searchParams.has('packet')) { // default to provided packet, if any
      packet = url.searchParams.get('packet');
      packet = decodeURIComponent(packet) + '—viacwop.rest';
    } else if (url.searchParams.has('id') &&  // otherwise, check for params needed to build our own
               url.searchParams.has('lat') &&
               url.searchParams.has('long') &&
               url.searchParams.has('time') &&
               url.searchParams.has('tempf') &&
               url.searchParams.has('windspeedmph') &&
               url.searchParams.has('windgustmph') &&
               url.searchParams.has('winddir')) {
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
      packet = body.packet + '—viacwop.rest';
    } else if (body.time && body.id && body.lat && body.long && body.tempf && body.windspeed && body.windgust && body.winddir) {  // otherwise, check for required params to build our own
      packet = buildPacket(body);
    } else {
      return new Response('Missing required packet or readings parameters in payload', { "status": 422 });
    }

    validationCode = body.validation;
    manuallySpecifiedServer = body.server;
    
  } else {  // we need either a provided packet or required readings to make our own
    return new Response('Invalid request method', { "status": 405 });  // HTTP 405 Method Not Allowed
  }

  console.log('Packet received: ' + packet);

  let validation = validatePacket(packet);
  if (validation !== true) {
    return validation;
  }

  // possibly valid! has this id sent recently?

  const id = packet.split('>')[0];
  const cacheKey = 'https://send.cwop.rest/id=' + id;
  const lastSentTimeResponse = await cache.match(cacheKey);
  if (lastSentTimeResponse) {
    const lastSentTime = await lastSentTimeResponse.text();
    if ((Date.now() - Number(lastSentTime)) < 290 * 1000) { // 5 minute cooldown w/ 10 second grace
      return new Response('Too many requests for ' + id, { "status": 429 }); // HTTP 429 Too Many Requests
    }
  }

  // attempting to send...
  let server = 'cwop.aprs.net';
  if (validationCode) server = 'rotate.aprs.net'; // http://www.wxqa.com/servers2use.html
  if (manuallySpecifiedServer) server = manuallySpecifiedServer;

  if (url.host !== 'send.cwop.rest') { // for testing
    return new Response('APRS packet "' + packet + '" would have been sent to ' + server, { "status": 200 });
  }
  
  try {
    await sendPacket(packet, server, 14580, validationCode);
  }
  catch(e) {
    await sendPacket(packet, server, 23, validationCode);
  }

  await cache.put(cacheKey, new Response(Date.now().toString()));

  return new Response('APRS packet "' + packet + '" sent to ' + server, { "status": 200 });

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
    if (observation.humidity) humidity = Number(observation.humidity);
    if (observation.solarradiation) solarradiation = Number(observation.solarradiation);
  }

  let packet = id + '>APRS,TCPIP*:@';

  packet += time.getUTCDate().toString().padStart(2, '0') +
            time.getUTCHours().toString().padStart(2, '0') +
            time.getUTCMinutes().toString().padStart(2, '0');
  
  if (lat < 0) {
    lat = Math.abs(lat);
    lat = Math.floor(lat).toString().padStart(2, 0) + (Math.floor(60 * parseFloat(lat % 1)*100)/100).toFixed(2).toString().padStart(5, 0) + 'S';
  } else {
    lat = Math.floor(lat).toString().padStart(2, 0) + (Math.floor(60 * parseFloat(lat % 1)*100)/100).toFixed(2).toString().padStart(5, 0) + 'N';
  }
  if (long < 0) {
    long = Math.abs(long);
    long = Math.floor(long).toString().padStart(3, 0) + (Math.floor(60 * parseFloat(long % 1)*100)/100).toFixed(2).toString().padStart(5, 0) + 'W';
  } else {
    long = Math.floor(long).toString().padStart(3, 0) + (Math.floor(60 * parseFloat(long % 1)*100)/100).toFixed(2).toString().padStart(5, 0) + 'E';
  }
  packet += 'z' + lat + '/' + long;

  packet += '_' + (winddir || '...').toString().padStart(3, '0');

  packet += '/' + (windspeedmph != null ? Math.ceil(windspeedmph) : '...').toString().padStart(3, '0');

  packet += 'g' + (windgustmph != null ? Math.ceil(windgustmph) : '...').toString().padStart(3, '0');

  if (tempf != null) {
    if (tempf >= 0) {
      packet += 't' + Math.round(tempf).toString().padStart(3, '0');
    } else {
      packet += 't' + '-' + Math.abs(Math.floor(tempf)).toString().padStart(2, '0');
    }
  } else {
    packet += 't...';
  }
  
  // optional readings
  if (rainhour != null) {
    packet += 'r' + (rainhour * 100).toFixed(0).toString().padStart(3, '0');
  }
  if (rainsincemidnight != null) {
    packet += 'P' + (rainsincemidnight * 100).toFixed(0).toString().padStart(3, '0');
  }
  if (rainlast24hr != null) {
    packet += 'p' + (rainlast24hr * 100).toFixed(0).toString().padStart(3, '0');
  }
  if (humidity != null) {
    packet += 'h' + (humidity % 100).toString().padStart(2, '0');
  }
  if (pressure != null) { // "altimeter" (QNH) format, in tenths of millibars
    packet += 'b' + (Math.round(pressure * 10)).toString().padStart(5, '0');
  }
  if (solarradiation != null) {
    if (solarradiation >= 1000) {
      packet += 'l' + (solarradiation % 1000).toString().padStart(3, '0');
    } else {
      packet += 'L' + solarradiation.toString().padStart(3, '0');
    }
  }

  packet += 'cwop.rest';

  return packet;

}

function validatePacket(packet) {

  // a few basic sanity checks
  if (!packet || typeof packet !== 'string' || packet.length < 53) {
    return new Response('Invalid or missing packet', { "status": 400 }); // HTTP 400 Bad Request
  }

  // confirm header is uppercase
  let header = packet.split('>')[0];
  if (header !== header.toUpperCase()) {
    return new Response('Packet header must be all uppercase', { "status": 422 }); // HTTP 422 Unprocessable Content
  }

  // check timestamp pattern
  const timePattern = /^(0[1-9]|[12][0-9]|3[01])([01][0-9]|2[0-3])[0-5][0-9]$/;
  let time = packet.substring(packet.indexOf('@') + 1, packet.lastIndexOf('z'));
  if (!timePattern.test(time)) {
    return new Response('Invalid time in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }

  // Check if timestamp is within last 5 minutes
  let day = parseInt(time.substring(0,2));
  let hour = parseInt(time.substring(2,4));
  let minute = parseInt(time.substring(4,6));

  let packetTimestamp = new Date();
  packetTimestamp.setUTCDate(day);
  packetTimestamp.setUTCHours(hour);
  packetTimestamp.setUTCMinutes(minute);
  packetTimestamp.setUTCSeconds(0);
  packetTimestamp.setUTCMilliseconds(0);
  let now = new Date();
  if (now.getTime() - packetTimestamp.getTime() > 5 * 60 * 1000) {
    return new Response('Timestamp in packet is not within last 5 minutes', { "status": 422 }); // HTTP 422 Unprocessable Content
  }
  
  // check latlong
  const latLongPattern = /(\d{2})(\d{2})\.\d{2}[NS]\/(\d{3})(\d{2})\.\d{2}[EW]/;
  let latlong = packet.substring(packet.indexOf('z') + 1, packet.lastIndexOf('_'));
  let latlongmatch = latlong.match(latLongPattern);
  if (!latlongmatch) {
    return new Response('Invalid location data in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }
  
  // check latlong values validity
  let latDegrees = parseInt(latlongmatch[1]);
  let latMinutes = parseInt(latlongmatch[2]);
  let lonDegrees = parseInt(latlongmatch[3]);
  let lonMinutes = parseInt(latlongmatch[4]);
  let latitude = latDegrees + latMinutes / 60;
  let longitude = lonDegrees + lonMinutes / 60;
  if (latitude < -90 || latitude > 90) {
    return new Response('Invalid latitude in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }
  if (longitude < -180 || longitude > 180) {
    return new Response('Invalid longitude in packet', { "status": 422 }); // HTTP 422 Unprocessable Content
  }

  return true;

}

export async function sendPacket(packet, server, port, validationCode = '-1') {

  console.log('Opening connection to ' + server + ':' + port);

  const socket = connect({ "hostname": server, "port": port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  
  // Wait for server's initial message - http://www.wxqa.com/faq.html
  let initialMessage = await reader.read();
  console.log('Received from server: ', new TextDecoder().decode(initialMessage.value));

  // Send login line
  const id = packet.split('>')[0];
  const loginLine = 'user ' + id + ' pass ' + validationCode + ' vers cwop.rest 1.0\r\n';
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

  writer.close();
  reader.releaseLock();
  
  let serverResponse = new TextDecoder().decode(value);
  console.log('Received from server: ', serverResponse);

  console.log('Closing connection to ' + server + ':' + port);
  
  return new Response(serverResponse, { "headers": { "Content-Type": "text/plain" } });
  
}