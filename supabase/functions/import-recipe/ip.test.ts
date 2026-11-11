import { assertEquals } from 'jsr:@std/assert@1';

import { isPublicAddress, parseIPv6 } from './ip.ts';

Deno.test('private, loopback, link-local and reserved IPv4 addresses are not public', () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assertEquals(isPublicAddress(address), false, address);
  }
});

Deno.test('public IPv4 addresses are public', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '151.101.1.69']) {
    assertEquals(isPublicAddress(address), true, address);
  }
});

Deno.test('IPv6 loopback, private, link-local and embedded private IPv4 are not public', () => {
  for (const address of [
    '::',
    '::1',
    '[::1]',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '2002:c0a8:0101::1',
    '2001:db8::1',
    '2001:0:4136:e378::1',
    'fe80::1%eth0',
  ]) {
    assertEquals(isPublicAddress(address), false, address);
  }
});

Deno.test('global IPv6 and mapped public IPv4 are public', () => {
  for (const address of ['2606:4700:4700::1111', '[2a00:1450:4009:81f::200e]', '::ffff:8.8.8.8']) {
    assertEquals(isPublicAddress(address), true, address);
  }
});

Deno.test('malformed addresses are not public', () => {
  for (const address of ['', 'example.com', '1.2.3', '1.2.3.256', '01.2.3.4', '1::2::3', 'g::1']) {
    assertEquals(isPublicAddress(address), false, address);
  }
});

Deno.test('IPv6 parsing expands :: and embedded IPv4', () => {
  assertEquals(parseIPv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  assertEquals(parseIPv6('2001:db8::1'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  assertEquals(parseIPv6('1:2:3:4:5:6:7:8:9'), null);
});
