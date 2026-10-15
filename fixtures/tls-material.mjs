import { generateKeyPairSync, sign } from 'node:crypto';

// Ephemeral fixture material: no private key or certificate is embedded in source.
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts.map(part => Buffer.from(part)));
  let length;
  if (body.length < 128) length = Buffer.from([body.length]);
  else { const hex = body.length.toString(16).padStart(Math.ceil(body.length.toString(16).length / 2) * 2, '0'); const bytes = Buffer.from(hex, 'hex'); length = Buffer.concat([Buffer.from([128 + bytes.length]), bytes]); }
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const seq = (...parts) => der(0x30, ...parts);
const oid = hex => der(6, Buffer.from(hex, 'hex'));

export function tlsFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = seq(oid('2a8648ce3d040302'));
  const name = seq(der(0x31, seq(oid('550403'), der(12, Buffer.from('Probe Harbor Fixture')))));
  const time = timestamp => {
    const value = new Date(timestamp).toISOString().slice(0, 19).replace(/\D/g, '') + 'Z';
    return der(Number(value.slice(0, 4)) < 2050 ? 23 : 24, Buffer.from(Number(value.slice(0, 4)) < 2050 ? value.slice(2) : value));
  };
  const validity = seq(time(Date.now() - 86_400_000), time(Date.now() + 86_400_000));
  const constraints = seq(oid('551d13'), der(1, [255]), der(4, seq(der(1, [255]))));
  const altNames = seq(oid('551d11'), der(4, seq(der(0x87, [127, 0, 0, 1]))));
  const tbs = seq(der(0xa0, der(2, [2])), der(2, [1]), algorithm, name, validity, name,
    publicKey.export({ format: 'der', type: 'spki' }), der(0xa3, seq(constraints, altNames)));
  const certificate = seq(tbs, algorithm, der(3, Buffer.from([0]), sign('sha256', tbs, privateKey)));
  const encoded = certificate.toString('base64').match(/.{1,64}/g).join('\n');
  return { key: privateKey.export({ format: 'pem', type: 'pkcs8' }), cert: `-----BEGIN CERTIFICATE-----\n${encoded}\n-----END CERTIFICATE-----\n` };
}
