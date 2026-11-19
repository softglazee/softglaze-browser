// @softglaze/protocol 0.1.0 (vendored, do not edit: run scripts/vendor-softglaze-protocol.mjs)
// Source: SoftGlaze-Mobile packages/protocol @ c1fd3936929369c0ef2c3009f524128b0145d5cf
// Bundled dependencies (MIT): @noble/ciphers 2.4.0, @noble/curves 2.4.0, @noble/hashes 2.4.0, valibot 1.5.0
// noble: Copyright (c) Paul Miller (https://paulmillr.com). valibot: Copyright (c) Fabian Hiller.
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region protocol/dist/bytes.js
function defaultRandom(length) {
	const c = globalThis.crypto;
	if (!c || typeof c.getRandomValues !== "function") throw new Error("No secure random source. In React Native call setRandomSource() with expo-crypto getRandomBytes, or install a crypto.getRandomValues polyfill before using @softglaze/protocol.");
	const out = new Uint8Array(length);
	for (let i = 0; i < length; i += 65536) c.getRandomValues(out.subarray(i, Math.min(length, i + 65536)));
	return out;
}
let randomSource = defaultRandom;
/** Replace the random source (for React Native without a getRandomValues polyfill). */
function setRandomSource(source) {
	randomSource = source;
}
function randomBytes(length) {
	const out = randomSource(length);
	if (!(out instanceof Uint8Array) || out.length !== length) throw new Error("Random source returned a bad value.");
	return out;
}
function concat(...parts) {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}
/** Constant time comparison (length is not secret). */
function equalBytes(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
/** Constant time string comparison for short codes. */
function equalStrings(a, b) {
	return equalBytes(utf8Encode(a), utf8Encode(b));
}
function utf8Encode(str) {
	const out = [];
	for (let i = 0; i < str.length; i++) {
		let cp = str.charCodeAt(i);
		if (cp >= 55296 && cp <= 56319 && i + 1 < str.length) {
			const lo = str.charCodeAt(i + 1);
			if (lo >= 56320 && lo <= 57343) {
				cp = 65536 + (cp - 55296 << 10) + (lo - 56320);
				i++;
			}
		}
		if (cp >= 55296 && cp <= 57343) cp = 65533;
		if (cp < 128) out.push(cp);
		else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
		else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
		else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
	}
	return Uint8Array.from(out);
}
/** Strict UTF-8 decoder: throws on malformed input. */
function utf8Decode(bytes) {
	let s = "";
	let i = 0;
	const bad = () => /* @__PURE__ */ new Error("Invalid UTF-8.");
	while (i < bytes.length) {
		const b0 = bytes[i++];
		let cp;
		if (b0 < 128) cp = b0;
		else if (b0 >= 194 && b0 < 224) {
			const b1 = bytes[i++];
			if (b1 === void 0 || (b1 & 192) !== 128) throw bad();
			cp = (b0 & 31) << 6 | b1 & 63;
		} else if (b0 >= 224 && b0 < 240) {
			const b1 = bytes[i++];
			const b2 = bytes[i++];
			if (b1 === void 0 || b2 === void 0 || (b1 & 192) !== 128 || (b2 & 192) !== 128) throw bad();
			cp = (b0 & 15) << 12 | (b1 & 63) << 6 | b2 & 63;
			if (cp < 2048 || cp >= 55296 && cp <= 57343) throw bad();
		} else if (b0 >= 240 && b0 < 245) {
			const b1 = bytes[i++];
			const b2 = bytes[i++];
			const b3 = bytes[i++];
			if (b1 === void 0 || b2 === void 0 || b3 === void 0 || (b1 & 192) !== 128 || (b2 & 192) !== 128 || (b3 & 192) !== 128) throw bad();
			cp = (b0 & 7) << 18 | (b1 & 63) << 12 | (b2 & 63) << 6 | b3 & 63;
			if (cp < 65536 || cp > 1114111) throw bad();
		} else throw bad();
		if (cp >= 65536) {
			cp -= 65536;
			s += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023));
		} else s += String.fromCharCode(cp);
	}
	return s;
}
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_REV = {};
for (let i = 0; i < 64; i++) B64URL_REV[B64URL[i]] = i;
/** base64url without padding (RFC 4648 section 5). */
function toBase64Url(bytes) {
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
		out += B64URL[n >> 18 & 63] + B64URL[n >> 12 & 63] + B64URL[n >> 6 & 63] + B64URL[n & 63];
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = bytes[i] << 16;
		out += B64URL[n >> 18 & 63] + B64URL[n >> 12 & 63];
	} else if (rest === 2) {
		const n = bytes[i] << 16 | bytes[i + 1] << 8;
		out += B64URL[n >> 18 & 63] + B64URL[n >> 12 & 63] + B64URL[n >> 6 & 63];
	}
	return out;
}
/** Strict base64url decoder (no padding, canonical trailing bits). */
function fromBase64Url(str) {
	if (typeof str !== "string" || str.length % 4 === 1) throw new Error("Invalid base64url.");
	const out = new Uint8Array(Math.floor(str.length * 3 / 4));
	let o = 0;
	let acc = 0;
	let bits = 0;
	for (let i = 0; i < str.length; i++) {
		const v = B64URL_REV[str[i]];
		if (v === void 0) throw new Error("Invalid base64url.");
		acc = acc << 6 | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = acc >> bits & 255;
		}
		acc &= (1 << bits) - 1;
	}
	if (acc !== 0) throw new Error("Invalid base64url (non canonical).");
	return out.subarray(0, o);
}
function hexToBytes(hex) {
	if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("Invalid hex.");
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}
function bytesToHex(bytes) {
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return s;
}
function u64be(n) {
	let v = BigInt(n);
	if (v < 0n || v >= 1n << 64n) throw new Error("u64 out of range.");
	const out = /* @__PURE__ */ new Uint8Array(8);
	for (let i = 7; i >= 0; i--) {
		out[i] = Number(v & 255n);
		v >>= 8n;
	}
	return out;
}
function readU64be(bytes, offset = 0) {
	let v = 0n;
	for (let i = 0; i < 8; i++) v = v << 8n | BigInt(bytes[offset + i]);
	return v;
}
function u32be(n) {
	return Uint8Array.of(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
}
function readU32be(bytes, offset = 0) {
	return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
}
/** Best effort wipe of secret material. */
function wipe(...arrays) {
	for (const a of arrays) if (a) a.fill(0);
}
//#endregion
//#region protocol/dist/errors.js
var ProtocolError = class extends Error {
	code;
	constructor(code, message) {
		super(message ?? code);
		this.code = code;
		this.name = "ProtocolError";
	}
};
//#endregion
//#region @noble/hashes/_u64.js
const U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
const _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
	if (le) return {
		h: Number(n & U32_MASK64),
		l: Number(n >> _32n & U32_MASK64)
	};
	return {
		h: Number(n >> _32n & U32_MASK64) | 0,
		l: Number(n & U32_MASK64) | 0
	};
}
function split(lst, le = false) {
	const len = lst.length;
	let Ah = new Uint32Array(len);
	let Al = new Uint32Array(len);
	for (let i = 0; i < len; i++) {
		const { h, l } = fromBig(lst[i], le);
		[Ah[i], Al[i]] = [h, l];
	}
	return [Ah, Al];
}
const fromNumH = (n) => n / 2 ** 32 | 0;
const fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
	const h = fromNumH(n);
	const l = fromNumL(n);
	view.setUint32(byteOffset, isLE ? l : h, isLE);
	view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}
const shrSH = (h, _l, s) => h >>> s;
const shrSL = (h, l, s) => h << 32 - s | l >>> s;
const rotrSH = (h, l, s) => h >>> s | l << 32 - s;
const rotrSL = (h, l, s) => h << 32 - s | l >>> s;
const rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
const rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
	const l = (Al >>> 0) + (Bl >>> 0);
	return {
		h: Ah + Bh + (l / 2 ** 32 | 0) | 0,
		l: l | 0
	};
}
const add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
const add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
const add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
const add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
const add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
const add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
//#endregion
//#region @noble/hashes/utils.js
/**
* Checks if something is Uint8Array. Be careful: nodejs Buffer will return true.
* @param a - value to test
* @returns `true` when the value is a Uint8Array-compatible view.
* @example
* Check whether a value is a Uint8Array-compatible view.
* ```ts
* isBytes(new Uint8Array([1, 2, 3]));
* ```
*/
function isBytes$2(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
const atitle$2 = (title) => title ? `"${title}" ` : "";
/**
* Asserts something is a non-negative integer.
* @param n - number to validate
* @param title - label included in thrown errors
* @returns The validated number.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a non-negative integer option.
* ```ts
* anumber(32, 'length');
* ```
*/
function anumber$2(n, title = "") {
	if (typeof n !== "number") throw new TypeError(atitle$2(title) + "expected number, got " + typeof n);
	if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(atitle$2(title) + "expected integer >= 0, got " + n);
	return n;
}
/**
* Asserts something is Uint8Array.
* @param value - value to validate
* @param length - optional exact length constraint
* @param title - label included in thrown errors
* @returns The validated byte array.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate that a value is a byte array.
* ```ts
* abytes(new Uint8Array([1, 2, 3]));
* ```
*/
function abytes$2(value, length, title = "") {
	if (isBytes$2(value) && (length === void 0 || value.length === length)) return value;
	if (length !== void 0) anumber$2(length, "length");
	const bytes = isBytes$2(value);
	const ofLen = length !== void 0 ? ` of length ${length}` : "";
	const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
	const message = atitle$2(title) + "expected Uint8Array" + ofLen + ", got " + got;
	if (!bytes) throw new TypeError(message);
	throw new RangeError(message);
}
/**
* Asserts something is a wrapped hash constructor.
* @param h - hash constructor to validate
* @throws On wrong argument types or invalid hash wrapper shape. {@link TypeError}
* @throws On invalid hash metadata ranges or values. {@link RangeError}
* @throws If the hash metadata allows empty outputs or block sizes. {@link Error}
* @example
* Validate a callable hash wrapper.
* ```ts
* import { ahash } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* ahash(sha256);
* ```
*/
function ahash(h) {
	if (typeof h !== "function" || typeof h.create !== "function") throw new TypeError("expected hash wrapped by utils.createHasher");
	anumber$2(h.outputLen);
	anumber$2(h.blockLen);
	if (h.outputLen < 1 || h.blockLen < 1) throw new Error("hash blockLen / outputLen must be >= 1");
}
const aobject$2 = (value, label) => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
const aopts = (value, label) => {
	aobject$2(value, label);
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) throw new TypeError(`"${label}" expected plain object`);
	if (Object.hasOwn(value, "__proto__")) throw new TypeError(`"${label}.__proto__" is not allowed`);
};
/**
* Asserts a hash instance has not been destroyed or finished.
* @param instance - hash instance to validate
* @param checkFinished - whether to reject finalized instances
* @throws If the hash instance has already been destroyed or finalized. {@link Error}
* @example
* Validate that a hash instance is still usable.
* ```ts
* import { aexists } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const hash = sha256.create();
* aexists(hash);
* ```
*/
function aexists$1(instance, checkFinished = true) {
	if (instance.destroyed) throw new Error("hash was destroyed");
	if (checkFinished && instance.finished) throw new Error("digest() was already called");
}
/**
* Asserts output is a sufficiently-sized byte array.
* @param out - destination buffer
* @param instance - hash instance providing output length
* Oversized buffers are allowed; downstream code only promises to fill the first `outputLen` bytes.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a caller-provided digest buffer.
* ```ts
* import { aoutput } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const hash = sha256.create();
* aoutput(new Uint8Array(hash.outputLen), hash);
* ```
*/
function aoutput$1(out, instance) {
	abytes$2(out, void 0, "output");
	const min = instance.outputLen;
	if (!(out.length >= min)) throw new RangeError("\"output\" expected length >= " + min);
}
/**
* Zeroizes typed arrays in place. Warning: JS provides no guarantees.
* @param arrays - arrays to overwrite with zeros
* @example
* Zeroize sensitive buffers in place.
* ```ts
* clean(new Uint8Array([1, 2, 3]));
* ```
*/
function clean$1(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
/**
* Creates a DataView for byte-level manipulation.
* @param arr - source typed array
* @returns DataView over the same buffer region.
* @example
* Create a DataView over an existing buffer.
* ```ts
* createView(new Uint8Array(4));
* ```
*/
function createView$1(arr) {
	return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/**
* Rotate-right operation for uint32 values.
* @param word - source word
* @param shift - shift amount in bits
* @returns Rotated word.
* @example
* Rotate a 32-bit word to the right.
* ```ts
* rotr(0x12345678, 8);
* ```
*/
function rotr(word, shift) {
	return word << 32 - shift | word >>> shift;
}
/**
* Rotate-left operation for uint32 values.
* @param word - source word
* @param shift - shift amount in bits
* @returns Rotated word.
* @example
* Rotate a 32-bit word to the left.
* ```ts
* rotl(0x12345678, 8);
* ```
*/
function rotl$1(word, shift) {
	return word << shift | word >>> 32 - shift >>> 0;
}
const hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
const hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
/**
* Convert byte array to hex string.
* Uses the built-in function when available and assumes it matches the tested
* fallback semantics.
* @param bytes - bytes to encode
* @returns Lowercase hexadecimal string.
* @throws On wrong argument types. {@link TypeError}
* @example
* Convert bytes to lowercase hexadecimal.
* ```ts
* bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])); // 'cafe0123'
* ```
*/
function bytesToHex$2(bytes) {
	abytes$2(bytes);
	if (hasHexBuiltin) return bytes.toHex();
	let hex = "";
	for (let i = 0; i < bytes.length; i++) hex += hexes[bytes[i]];
	return hex;
}
function asciiToBase16(ch) {
	return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - 55 : ch >= 97 && ch <= 102 ? ch - 87 : void 0;
}
/**
* Convert hex string to byte array. Uses built-in function, when available.
* @param hex - hexadecimal string to decode
* @returns Decoded bytes.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Decode lowercase hexadecimal into bytes.
* ```ts
* hexToBytes('cafe0123'); // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
* ```
*/
function hexToBytes$2(hex) {
	if (typeof hex !== "string") throw new TypeError("hex string expected, got " + typeof hex);
	if (hasHexBuiltin) try {
		return Uint8Array.fromHex(hex);
	} catch (error) {
		if (error instanceof SyntaxError) throw new RangeError(error.message);
		throw error;
	}
	const hl = hex.length;
	const al = hl / 2;
	if (hl % 2) throw new RangeError("hex string expected, got unpadded hex of length " + hl);
	const array = new Uint8Array(al);
	for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
		const n1 = asciiToBase16(hex.charCodeAt(hi));
		const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
		if (n1 === void 0 || n2 === void 0) {
			const char = hex[hi] + hex[hi + 1];
			throw new RangeError("hex string expected, got non-hex character \"" + char + "\" at index " + hi);
		}
		array[ai] = n1 * 16 + n2;
	}
	return array;
}
/**
* Copies several Uint8Arrays into one.
* @param arrays - arrays to concatenate
* @returns Concatenated byte array.
* @throws On wrong argument types. {@link TypeError}
* @example
* Concatenate multiple byte arrays.
* ```ts
* concatBytes(new Uint8Array([1]), new Uint8Array([2]));
* ```
*/
function concatBytes$1(...arrays) {
	let sum = 0;
	for (let i = 0; i < arrays.length; i++) {
		const a = arrays[i];
		abytes$2(a);
		sum += a.length;
	}
	const res = new Uint8Array(sum);
	for (let i = 0, pad = 0; i < arrays.length; i++) {
		const a = arrays[i];
		res.set(a, pad);
		pad += a.length;
	}
	return res;
}
/**
* Merges default options and passed options.
* @param defaults - base option object
* @param opts - user overrides
* @param title - label included in thrown override errors
* @returns Fresh merged option object with a null prototype.
* @throws On wrong argument types. {@link TypeError}
* @example
* Merge user overrides onto default options.
* ```ts
* checkOpts({ dkLen: 32 }, { asyncTick: 10 });
* ```
*/
function checkOpts$2(defaults, opts, title = "opts") {
	aopts(defaults, "defaults");
	if (opts !== void 0) aopts(opts, title);
	return Object.assign(Object.create(null), defaults, opts);
}
/**
* Creates a callable hash function from a stateful class constructor.
* @param hashCons - hash constructor or factory
* @param info - optional metadata such as DER OID
* @returns Frozen callable hash wrapper with `.create()`.
*   Wrapper construction eagerly calls `hashCons(undefined)` once to read
*   `outputLen` / `blockLen`, so constructor side effects happen at module
*   init time.
* @throws On wrong argument types. {@link TypeError}
* @example
* Wrap a stateful hash constructor into a callable helper.
* ```ts
* import { createHasher } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const wrapped = createHasher(sha256.create, { oid: sha256.oid });
* wrapped(new Uint8Array([1]));
* ```
*/
function createHasher(hashCons, info = {}) {
	if (typeof hashCons !== "function") throw new TypeError("\"hashCons\" expected function, got type=" + typeof hashCons);
	info = checkOpts$2({}, info, "info");
	const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
	const tmp = hashCons(void 0);
	hashC.outputLen = tmp.outputLen;
	hashC.blockLen = tmp.blockLen;
	hashC.canXOF = tmp.canXOF;
	hashC.create = (opts) => hashCons(opts);
	Object.assign(hashC, info);
	return Object.freeze(hashC);
}
/**
* Cryptographically secure PRNG backed by `crypto.getRandomValues`.
* @param bytesLength - number of random bytes to generate
* @returns Random bytes.
* The platform `getRandomValues()` implementation still defines any
* single-call length cap, and this helper rejects oversize requests
* with a stable library `RangeError` instead of host-specific errors.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @throws If the current runtime does not provide `crypto.getRandomValues`. {@link Error}
* @example
* Generate a fresh random key or nonce.
* ```ts
* const key = randomBytes(16);
* ```
*/
function randomBytes$2(bytesLength = 32) {
	anumber$2(bytesLength, "bytesLength");
	const cr = typeof globalThis === "object" ? globalThis.crypto : null;
	if (typeof cr?.getRandomValues !== "function") throw new Error("crypto.getRandomValues must be defined");
	if (bytesLength > 65536) throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
	return cr.getRandomValues(new Uint8Array(bytesLength));
}
/**
* Creates OID metadata for NIST hashes with prefix `06 09 60 86 48 01 65 03 04 02`.
* @param suffix - final OID byte for the selected hash.
*   The helper accepts any byte even though only the documented NIST hash
*   suffixes are meaningful downstream.
* @returns Object containing the DER-encoded OID.
* @example
* Build OID metadata for a NIST hash.
* ```ts
* oidNist(0x01);
* ```
*/
const oidNist = (suffix) => ({ oid: Uint8Array.from([
	6,
	9,
	96,
	134,
	72,
	1,
	101,
	3,
	4,
	2,
	suffix
]) });
//#endregion
//#region @noble/hashes/_md.js
/**
* Internal Merkle-Damgard hash utils.
* @module
*/
/**
* Shared 32-bit conditional boolean primitive reused by SHA-256, SHA-1, and MD5 `F`.
* Returns bits from `b` when `a` is set, otherwise from `c`.
* The XOR form is equivalent to MD5's `F(X,Y,Z) = XY v not(X)Z` because the masked terms never
* set the same bit.
* @param a - selector word
* @param b - word chosen when selector bit is set
* @param c - word chosen when selector bit is clear
* @returns Mixed 32-bit word.
* @example
* Combine three words with the shared 32-bit choice primitive.
* ```ts
* Chi(0xffffffff, 0x12345678, 0x87654321);
* ```
*/
function Chi(a, b, c) {
	return a & b ^ ~a & c;
}
/**
* Shared 32-bit majority primitive reused by SHA-256 and SHA-1.
* Returns bits shared by at least two inputs.
* @param a - first input word
* @param b - second input word
* @param c - third input word
* @returns Mixed 32-bit word.
* @example
* Combine three words with the shared 32-bit majority primitive.
* ```ts
* Maj(0xffffffff, 0x12345678, 0x87654321);
* ```
*/
function Maj(a, b, c) {
	return a & b ^ a & c ^ b & c;
}
/**
* Merkle-Damgard hash construction base class.
* Could be used to create MD5, RIPEMD, SHA1, SHA2.
* Accepts only byte-aligned `Uint8Array` input, even when the underlying spec describes bit
* strings with partial-byte tails.
* @param blockLen - internal block size in bytes
* @param outputLen - digest size in bytes
* @param padOffset - trailing length field size in bytes
* @param isLE - whether length and state words are encoded in little-endian
* @example
* Use a concrete subclass to get the shared Merkle-Damgard update/digest flow.
* ```ts
* import { _SHA1 } from '@noble/hashes/legacy.js';
* const hash = new _SHA1();
* hash.update(new Uint8Array([97, 98, 99]));
* hash.digest();
* ```
*/
var HashMD = class {
	blockLen;
	outputLen;
	canXOF = false;
	padOffset;
	isLE;
	buffer;
	view;
	finished = false;
	length = 0;
	pos = 0;
	destroyed = false;
	constructor(blockLen, outputLen, padOffset, isLE) {
		this.blockLen = blockLen;
		this.outputLen = outputLen;
		this.padOffset = padOffset;
		this.isLE = isLE;
		this.buffer = new Uint8Array(blockLen);
		this.view = createView$1(this.buffer);
	}
	update(data) {
		aexists$1(this);
		abytes$2(data);
		const { view, buffer, blockLen } = this;
		const len = data.length;
		let processed = false;
		for (let pos = 0; pos < len;) {
			const take = Math.min(blockLen - this.pos, len - pos);
			if (take === blockLen) {
				const dataView = createView$1(data);
				for (; blockLen <= len - pos; pos += blockLen) this.process(dataView, pos);
				processed = true;
				continue;
			}
			buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
			this.pos += take;
			pos += take;
			if (this.pos === blockLen) {
				this.process(view, 0);
				this.pos = 0;
				processed = true;
			}
		}
		this.length += data.length;
		if (processed) this.roundClean();
		return this;
	}
	digestInto(out) {
		aexists$1(this);
		aoutput$1(out, this);
		this.finished = true;
		const { buffer, view, blockLen, isLE } = this;
		let { pos } = this;
		buffer[pos++] = 128;
		buffer.fill(0, pos);
		if (this.padOffset > blockLen - pos) {
			this.process(view, 0);
			buffer.fill(0);
		}
		setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
		this.process(view, 0);
		this.roundClean();
		const oview = out === buffer ? view : createView$1(out);
		const len = this.outputLen;
		const outLen = len / 4;
		const state = this.get();
		if (len % 4 || outLen > state.length) throw new Error("invalid outputLen");
		for (let i = 0; i < outLen; i++) oview.setUint32(4 * i, state[i], isLE);
	}
	digest() {
		const { buffer, outputLen } = this;
		this.digestInto(buffer);
		const res = buffer.slice(0, outputLen);
		this.destroy();
		return res;
	}
	_cloneIntoMeta(to) {
		const { buffer, length, finished, destroyed, pos } = this;
		to.destroyed = destroyed;
		to.finished = finished;
		to.length = length;
		to.pos = pos;
		if (pos) to.buffer.set(buffer);
		return to;
	}
	clone() {
		return this._cloneInto();
	}
};
/**
* Initial SHA-2 state: fractional parts of square roots of first 16 primes 2..53.
* Check out `test/misc/sha2-gen-iv.js` for recomputation guide.
*/
/** Initial SHA256 state from RFC 6234 §6.1: the first 32 bits of the fractional parts of the
* square roots of the first eight prime numbers. Exported as a shared table; callers must treat
* it as read-only because constructors copy words from it by index. */
const SHA256_IV = /* @__PURE__ */ Uint32Array.from([
	1779033703,
	3144134277,
	1013904242,
	2773480762,
	1359893119,
	2600822924,
	528734635,
	1541459225
]);
/** Initial SHA512 state from RFC 6234 §6.3: eight RFC 64-bit `H(0)` words stored as sixteen
* big-endian 32-bit halves. Derived from the fractional parts of the square roots of the first
* eight prime numbers. Exported as a shared table; callers must treat it as read-only because
* constructors copy halves from it by index. */
const SHA512_IV = /* @__PURE__ */ Uint32Array.from([
	1779033703,
	4089235720,
	3144134277,
	2227873595,
	1013904242,
	4271175723,
	2773480762,
	1595750129,
	1359893119,
	2917565137,
	2600822924,
	725511199,
	528734635,
	4215389547,
	1541459225,
	327033209
]);
//#endregion
//#region @noble/hashes/sha2.js
/**
* SHA2 hash function. A.k.a. sha256, sha384, sha512, sha512_224, sha512_256.
* SHA256 is the fastest hash implementable in JS, even faster than Blake3.
* Check out {@link https://www.rfc-editor.org/rfc/rfc4634 | RFC 4634} and
* {@link https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf | FIPS 180-4}.
* @module
*/
/**
* SHA-224 / SHA-256 round constants from RFC 6234 §5.1: the first 32 bits
* of the cube roots of the first 64 primes (2..311).
*/
const SHA256_K = /* @__PURE__ */ Uint32Array.from([
	1116352408,
	1899447441,
	3049323471,
	3921009573,
	961987163,
	1508970993,
	2453635748,
	2870763221,
	3624381080,
	310598401,
	607225278,
	1426881987,
	1925078388,
	2162078206,
	2614888103,
	3248222580,
	3835390401,
	4022224774,
	264347078,
	604807628,
	770255983,
	1249150122,
	1555081692,
	1996064986,
	2554220882,
	2821834349,
	2952996808,
	3210313671,
	3336571891,
	3584528711,
	113926993,
	338241895,
	666307205,
	773529912,
	1294757372,
	1396182291,
	1695183700,
	1986661051,
	2177026350,
	2456956037,
	2730485921,
	2820302411,
	3259730800,
	3345764771,
	3516065817,
	3600352804,
	4094571909,
	275423344,
	430227734,
	506948616,
	659060556,
	883997877,
	958139571,
	1322822218,
	1537002063,
	1747873779,
	1955562222,
	2024104815,
	2227730452,
	2361852424,
	2428436474,
	2756734187,
	3204031479,
	3329325298
]);
/** Reusable SHA-224 / SHA-256 message schedule buffer `W_t` from RFC 6234 §6.2 step 1. */
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
/** Internal SHA-224 / SHA-256 compression engine from RFC 6234 §6.2. */
var SHA2_32B = class extends HashMD {
	A = 0;
	B = 0;
	C = 0;
	D = 0;
	E = 0;
	F = 0;
	G = 0;
	H = 0;
	constructor(outputLen, IV) {
		super(64, outputLen, 8, false);
		this.A = IV[0] | 0;
		this.B = IV[1] | 0;
		this.C = IV[2] | 0;
		this.D = IV[3] | 0;
		this.E = IV[4] | 0;
		this.F = IV[5] | 0;
		this.G = IV[6] | 0;
		this.H = IV[7] | 0;
	}
	get() {
		const { A, B, C, D, E, F, G, H } = this;
		return [
			A,
			B,
			C,
			D,
			E,
			F,
			G,
			H
		];
	}
	set(A, B, C, D, E, F, G, H) {
		this.A = A | 0;
		this.B = B | 0;
		this.C = C | 0;
		this.D = D | 0;
		this.E = E | 0;
		this.F = F | 0;
		this.G = G | 0;
		this.H = H | 0;
	}
	_cloneInto(to) {
		(to ||= new this.constructor()).set(...this.get());
		return this._cloneIntoMeta(to);
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) SHA256_W[i] = view.getUint32(offset, false);
		for (let i = 16; i < 64; i++) {
			const W15 = SHA256_W[i - 15];
			const W2 = SHA256_W[i - 2];
			const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
			const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
			SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
		}
		let { A, B, C, D, E, F, G, H } = this;
		for (let i = 0; i < 64; i++) {
			const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
			const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
			const T2 = (rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22)) + Maj(A, B, C) | 0;
			H = G;
			G = F;
			F = E;
			E = D + T1 | 0;
			D = C;
			C = B;
			B = A;
			A = T1 + T2 | 0;
		}
		A = A + this.A | 0;
		B = B + this.B | 0;
		C = C + this.C | 0;
		D = D + this.D | 0;
		E = E + this.E | 0;
		F = F + this.F | 0;
		G = G + this.G | 0;
		H = H + this.H | 0;
		this.set(A, B, C, D, E, F, G, H);
	}
	roundClean() {
		clean$1(SHA256_W);
	}
	destroy() {
		this.destroyed = true;
		this.set(0, 0, 0, 0, 0, 0, 0, 0);
		clean$1(this.buffer);
	}
};
/** Internal SHA-256 hash class grounded in RFC 6234 §6.2. */
var _SHA256 = class extends SHA2_32B {
	constructor() {
		super(32, SHA256_IV);
	}
};
const K512 = /* @__PURE__ */ (() => split([
	"0x428a2f98d728ae22",
	"0x7137449123ef65cd",
	"0xb5c0fbcfec4d3b2f",
	"0xe9b5dba58189dbbc",
	"0x3956c25bf348b538",
	"0x59f111f1b605d019",
	"0x923f82a4af194f9b",
	"0xab1c5ed5da6d8118",
	"0xd807aa98a3030242",
	"0x12835b0145706fbe",
	"0x243185be4ee4b28c",
	"0x550c7dc3d5ffb4e2",
	"0x72be5d74f27b896f",
	"0x80deb1fe3b1696b1",
	"0x9bdc06a725c71235",
	"0xc19bf174cf692694",
	"0xe49b69c19ef14ad2",
	"0xefbe4786384f25e3",
	"0x0fc19dc68b8cd5b5",
	"0x240ca1cc77ac9c65",
	"0x2de92c6f592b0275",
	"0x4a7484aa6ea6e483",
	"0x5cb0a9dcbd41fbd4",
	"0x76f988da831153b5",
	"0x983e5152ee66dfab",
	"0xa831c66d2db43210",
	"0xb00327c898fb213f",
	"0xbf597fc7beef0ee4",
	"0xc6e00bf33da88fc2",
	"0xd5a79147930aa725",
	"0x06ca6351e003826f",
	"0x142929670a0e6e70",
	"0x27b70a8546d22ffc",
	"0x2e1b21385c26c926",
	"0x4d2c6dfc5ac42aed",
	"0x53380d139d95b3df",
	"0x650a73548baf63de",
	"0x766a0abb3c77b2a8",
	"0x81c2c92e47edaee6",
	"0x92722c851482353b",
	"0xa2bfe8a14cf10364",
	"0xa81a664bbc423001",
	"0xc24b8b70d0f89791",
	"0xc76c51a30654be30",
	"0xd192e819d6ef5218",
	"0xd69906245565a910",
	"0xf40e35855771202a",
	"0x106aa07032bbd1b8",
	"0x19a4c116b8d2d0c8",
	"0x1e376c085141ab53",
	"0x2748774cdf8eeb99",
	"0x34b0bcb5e19b48a8",
	"0x391c0cb3c5c95a63",
	"0x4ed8aa4ae3418acb",
	"0x5b9cca4f7763e373",
	"0x682e6ff3d6b2b8a3",
	"0x748f82ee5defb2fc",
	"0x78a5636f43172f60",
	"0x84c87814a1f0ab72",
	"0x8cc702081a6439ec",
	"0x90befffa23631e28",
	"0xa4506cebde82bde9",
	"0xbef9a3f7b2c67915",
	"0xc67178f2e372532b",
	"0xca273eceea26619c",
	"0xd186b8c721c0c207",
	"0xeada7dd6cde0eb1e",
	"0xf57d4f7fee6ed178",
	"0x06f067aa72176fba",
	"0x0a637dc5a2c898a6",
	"0x113f9804bef90dae",
	"0x1b710b35131c471b",
	"0x28db77f523047d84",
	"0x32caab7b40c72493",
	"0x3c9ebe0a15c9bebc",
	"0x431d67c49c100d4c",
	"0x4cc5d4becb3e42b6",
	"0x597f299cfc657e2a",
	"0x5fcb6fab3ad6faec",
	"0x6c44198c4a475817"
].map((n) => BigInt(n))))();
const SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
const SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
const SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
const SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
/** Internal SHA-384 / SHA-512 compression engine from RFC 6234 §6.4. */
var SHA2_64B = class extends HashMD {
	Ah = 0;
	Al = 0;
	Bh = 0;
	Bl = 0;
	Ch = 0;
	Cl = 0;
	Dh = 0;
	Dl = 0;
	Eh = 0;
	El = 0;
	Fh = 0;
	Fl = 0;
	Gh = 0;
	Gl = 0;
	Hh = 0;
	Hl = 0;
	constructor(outputLen, IV) {
		super(128, outputLen, 16, false);
		this.Ah = IV[0] | 0;
		this.Al = IV[1] | 0;
		this.Bh = IV[2] | 0;
		this.Bl = IV[3] | 0;
		this.Ch = IV[4] | 0;
		this.Cl = IV[5] | 0;
		this.Dh = IV[6] | 0;
		this.Dl = IV[7] | 0;
		this.Eh = IV[8] | 0;
		this.El = IV[9] | 0;
		this.Fh = IV[10] | 0;
		this.Fl = IV[11] | 0;
		this.Gh = IV[12] | 0;
		this.Gl = IV[13] | 0;
		this.Hh = IV[14] | 0;
		this.Hl = IV[15] | 0;
	}
	get() {
		const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
		return [
			Ah,
			Al,
			Bh,
			Bl,
			Ch,
			Cl,
			Dh,
			Dl,
			Eh,
			El,
			Fh,
			Fl,
			Gh,
			Gl,
			Hh,
			Hl
		];
	}
	set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
		this.Ah = Ah | 0;
		this.Al = Al | 0;
		this.Bh = Bh | 0;
		this.Bl = Bl | 0;
		this.Ch = Ch | 0;
		this.Cl = Cl | 0;
		this.Dh = Dh | 0;
		this.Dl = Dl | 0;
		this.Eh = Eh | 0;
		this.El = El | 0;
		this.Fh = Fh | 0;
		this.Fl = Fl | 0;
		this.Gh = Gh | 0;
		this.Gl = Gl | 0;
		this.Hh = Hh | 0;
		this.Hl = Hl | 0;
	}
	_cloneInto(to) {
		(to ||= new this.constructor()).set(...this.get());
		return this._cloneIntoMeta(to);
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) {
			SHA512_W_H[i] = view.getUint32(offset);
			SHA512_W_L[i] = view.getUint32(offset += 4);
		}
		for (let i = 16; i < 80; i++) {
			const W15h = SHA512_W_H[i - 15] | 0;
			const W15l = SHA512_W_L[i - 15] | 0;
			const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
			const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
			const W2h = SHA512_W_H[i - 2] | 0;
			const W2l = SHA512_W_L[i - 2] | 0;
			const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
			const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
			const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
			const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
			SHA512_W_H[i] = SUMh | 0;
			SHA512_W_L[i] = SUMl | 0;
		}
		let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
		for (let i = 0; i < 80; i++) {
			const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
			const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
			const CHIh = Eh & Fh ^ ~Eh & Gh;
			const CHIl = El & Fl ^ ~El & Gl;
			const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
			const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
			const T1l = T1ll | 0;
			const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
			const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
			const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
			const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
			Hh = Gh | 0;
			Hl = Gl | 0;
			Gh = Fh | 0;
			Gl = Fl | 0;
			Fh = Eh | 0;
			Fl = El | 0;
			({h: Eh, l: El} = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
			Dh = Ch | 0;
			Dl = Cl | 0;
			Ch = Bh | 0;
			Cl = Bl | 0;
			Bh = Ah | 0;
			Bl = Al | 0;
			const All = add3L(T1l, sigma0l, MAJl);
			Ah = add3H(All, T1h, sigma0h, MAJh);
			Al = All | 0;
		}
		({h: Ah, l: Al} = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
		({h: Bh, l: Bl} = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
		({h: Ch, l: Cl} = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
		({h: Dh, l: Dl} = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
		({h: Eh, l: El} = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
		({h: Fh, l: Fl} = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
		({h: Gh, l: Gl} = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
		({h: Hh, l: Hl} = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
		this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
	}
	roundClean() {
		clean$1(SHA512_W_H, SHA512_W_L);
	}
	destroy() {
		this.destroyed = true;
		clean$1(this.buffer);
		this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
	}
};
/** Internal SHA-512 hash class grounded in RFC 6234 §6.3 and §6.4. */
var _SHA512 = class extends SHA2_64B {
	constructor() {
		super(64, SHA512_IV);
	}
};
/**
* SHA2-256 hash function from RFC 4634. In JS it's the fastest: even faster than Blake3. Some info:
*
* - Trying 2^128 hashes would get 50% chance of collision, using birthday attack.
* - BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per 2025.
* - Each sha256 hash is executing 2^18 bit operations.
* - Good 2024 ASICs can do 200Th/sec with 3500 watts of power, corresponding to 2^36 hashes/joule.
* @param msg - message bytes to hash
* @param opts - Reserved hash options.
* @returns Digest bytes.
* @example
* Hash a message with SHA2-256.
* ```ts
* sha256(new Uint8Array([97, 98, 99]));
* ```
*/
const sha256 = /* @__PURE__ */ createHasher(() => new _SHA256(), /* @__PURE__ */ oidNist(1));
/**
* SHA2-512 hash function from RFC 4634.
* @param msg - message bytes to hash
* @param opts - Reserved hash options.
* @returns Digest bytes.
* @example
* Hash a message with SHA2-512.
* ```ts
* sha512(new Uint8Array([97, 98, 99]));
* ```
*/
const sha512 = /* @__PURE__ */ createHasher(() => new _SHA512(), /* @__PURE__ */ oidNist(3));
//#endregion
//#region @noble/curves/utils.js
/**
* Hex, bytes and number utilities.
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
/**
* Validates that a value is an array, optionally validating each element.
* @param item - Value to validate.
* @param title - Label included in thrown errors.
* @param inner - Optional per-element validator, called with the element and its label.
* @returns The validated array.
* @example
* Validate an array of points before batch processing.
*
* ```ts
* aarray([1n, 2n], 'scalars');
* ```
*/
function aarray(item, title, inner = () => {}) {
	if (!Array.isArray(item)) throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
	for (let i = 0; i < item.length; i++) inner(item[i], `${title}[${i}]`);
	return item;
}
/**
* Validates that a value is a byte array.
* @param value - Value to validate.
* @param length - Optional exact byte length.
* @param title - Optional field name.
* @returns Original byte array.
* @example
* Reject non-byte input before passing data into curve code.
*
* ```ts
* abytes(new Uint8Array(1));
* ```
*/
const abytes$1 = (value, length, title) => abytes$2(value, length, title);
/**
* Validates that a value is a non-negative safe integer.
* @param n - Value to validate.
* @param title - Optional field name.
* @returns The validated number.
* @example
* Validate a numeric length before allocating buffers.
*
* ```ts
* anumber(1);
* ```
*/
const anumber$1 = anumber$2;
/**
* Asserts something is a plain object-ish value, not null or array.
* @param value - Value to validate.
* @param title - Label included in thrown errors.
* @returns The validated object.
* @throws On wrong argument types. {@link TypeError}
* @example
* Validate an options object before checking fields.
*
* ```ts
* aobject({ flag: true });
* ```
*/
function aobject$1(value, title = "object") {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
	return value;
}
/**
* Asserts something is a function.
* @param value - Value to validate.
* @param title - Label included in thrown errors.
* @returns The validated function.
* @throws On wrong argument types. {@link TypeError}
* @example
* Validate a required method before calling it.
*
* ```ts
* afunction(() => true, 'predicate');
* ```
*/
function afunction(value, title) {
	if (typeof value !== "function") throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
	return value;
}
/**
* Encodes bytes as lowercase hex.
* @param bytes - Bytes to encode.
* @returns Lowercase hex string.
* @example
* Serialize bytes as hex for logging or fixtures.
*
* ```ts
* bytesToHex(Uint8Array.of(1, 2, 3));
* ```
*/
const bytesToHex$1 = bytesToHex$2;
/**
* Concatenates byte arrays.
* @param arrays - Byte arrays to join.
* @returns Concatenated bytes.
* @example
* Join domain-separated chunks into one buffer.
*
* ```ts
* concatBytes(Uint8Array.of(1), Uint8Array.of(2));
* ```
*/
const concatBytes = (...arrays) => concatBytes$1(...arrays);
/**
* Decodes lowercase or uppercase hex into bytes.
* @param hex - Hex string to decode.
* @returns Decoded bytes.
* @example
* Parse fixture hex into bytes before hashing.
*
* ```ts
* hexToBytes('0102');
* ```
*/
const hexToBytes$1 = (hex) => hexToBytes$2(hex);
/**
* Checks whether a value is a Uint8Array.
* @param a - Value to inspect.
* @returns `true` when `a` is a Uint8Array.
* @example
* Branch on byte input before decoding it.
*
* ```ts
* isBytes(new Uint8Array(1));
* ```
*/
const isBytes$1 = isBytes$2;
/**
* Reads random bytes from the platform CSPRNG.
* @param bytesLength - Number of random bytes to read.
* @returns Fresh random bytes.
* @example
* Generate a random seed for a keypair.
*
* ```ts
* randomBytes(2);
* ```
*/
const randomBytes$1 = (bytesLength) => randomBytes$2(bytesLength);
const _0n$5 = /* @__PURE__ */ BigInt(0);
const _1n$5 = /* @__PURE__ */ BigInt(1);
const atitle$1 = (title) => title ? `"${title}" ` : "";
/**
* Validates that a flag is boolean.
* @param value - Value to validate.
* @param title - Optional field name.
* @returns Original value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Reject non-boolean option flags early.
*
* ```ts
* abool(true);
* ```
*/
function abool$1(value, title = "") {
	if (typeof value !== "boolean") throw new TypeError(atitle$1(title) + "expected boolean, got type=" + typeof value);
	return value;
}
/**
* Validates that a value is a non-negative bigint or safe integer.
* @param n - Value to validate.
* @returns The same validated value.
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate one integer-like value before serializing it.
*
* ```ts
* abignumber(1n);
* ```
*/
function abignumber(n) {
	if (typeof n === "bigint") {
		if (!isPosBig(n)) throw new RangeError("positive bigint expected, got " + n);
	} else anumber$1(n);
	return n;
}
/**
* Validates that a value is a safe integer.
* @param value - Integer to validate.
* @param title - Optional field name.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a window size before scalar arithmetic uses it.
*
* ```ts
* asafenumber(1);
* ```
*/
function asafenumber(value, title = "") {
	if (typeof value !== "number") {
		const prefix = title && `"${title}" `;
		throw new TypeError(prefix + "expected number, got type=" + typeof value);
	}
	if (!Number.isSafeInteger(value)) {
		const prefix = title && `"${title}" `;
		throw new RangeError(prefix + "expected safe integer, got " + value);
	}
}
/**
* Parses a big-endian hex string into bigint.
* Accepts odd-length hex through the native `BigInt('0x' + hex)` parser and currently surfaces the
* same native `SyntaxError` for malformed hex instead of wrapping it in a library-specific error.
* @param hex - Hex string without `0x`.
* @returns Parsed bigint value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Parse a scalar from fixture hex.
*
* ```ts
* hexToNumber('ff');
* ```
*/
function hexToNumber(hex) {
	if (typeof hex !== "string") throw new TypeError("hex string expected, got " + typeof hex);
	return hex === "" ? _0n$5 : BigInt("0x" + hex);
}
/**
* Parses big-endian bytes into bigint.
* @param bytes - Bytes in big-endian order.
* @returns Parsed bigint value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Read a scalar encoded in network byte order.
*
* ```ts
* bytesToNumberBE(Uint8Array.of(1, 0));
* ```
*/
function bytesToNumberBE(bytes) {
	return hexToNumber(bytesToHex$2(bytes));
}
/**
* Parses little-endian bytes into bigint.
* @param bytes - Bytes in little-endian order.
* @returns Parsed bigint value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Read a scalar encoded in little-endian form.
*
* ```ts
* bytesToNumberLE(Uint8Array.of(1, 0));
* ```
*/
function bytesToNumberLE(bytes) {
	return hexToNumber(bytesToHex$2(copyBytes$1(abytes$2(bytes)).reverse()));
}
/**
* Encodes a bigint into fixed-length big-endian bytes.
* @param n - Number to encode.
* @param len - Output length in bytes. Must be greater than zero.
* @returns Big-endian byte array.
* @throws On wrong argument ranges or values. {@link RangeError}
* @throws If a documented runtime validation or state check fails. {@link Error}
* @example
* Serialize a scalar into a 32-byte field element.
*
* ```ts
* numberToBytesBE(255n, 2);
* ```
*/
function numberToBytesBE(n, len) {
	anumber$2(len);
	if (len === 0) throw new Error("zero output length is invalid");
	n = abignumber(n);
	const expectedLen = len * 2;
	const hex = n.toString(16);
	if (hex.length > expectedLen) throw new RangeError("number is too large");
	return hexToBytes$2(hex.padStart(expectedLen, "0"));
}
/**
* Encodes a bigint into fixed-length little-endian bytes.
* @param n - Number to encode.
* @param len - Output length in bytes.
* @returns Little-endian byte array.
* @throws On wrong argument ranges or values. {@link RangeError}
* @throws If a documented runtime validation or state check fails. {@link Error}
* @example
* Serialize a scalar for little-endian protocols.
*
* ```ts
* numberToBytesLE(255n, 2);
* ```
*/
function numberToBytesLE(n, len) {
	return numberToBytesBE(n, len).reverse();
}
/**
* Copies Uint8Array. We can't use u8a.slice(), because u8a can be Buffer,
* and Buffer#slice creates mutable copy. Never use Buffers!
* @param bytes - Bytes to copy.
* @returns Detached copy.
* @example
* Make an isolated copy before mutating serialized bytes.
*
* ```ts
* copyBytes(Uint8Array.of(1, 2, 3));
* ```
*/
function copyBytes$1(bytes) {
	return Uint8Array.from(abytes$1(bytes));
}
/**
* Checks whether n is non-negative bigint. Historical name.
* @param n - candidate value
* @returns `true` when the value is bigint and 0 or larger
* @example
* Check a candidate scalar before range validation.
*
* ```ts
* isPosBig(2n);
* ```
*/
function isPosBig(n) {
	return typeof n === "bigint" && _0n$5 <= n;
}
/**
* Checks whether a bigint lies inside a half-open range.
* @param n - Candidate value.
* @param min - Inclusive lower bound.
* @param max - Exclusive upper bound.
* @returns `true` when the value is inside the range.
* @example
* Check whether a candidate scalar fits the field order.
*
* ```ts
* inRange(2n, 1n, 3n);
* ```
*/
function inRange(n, min, max) {
	return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
/**
* Asserts `min <= n < max`. NOTE: upper bound is exclusive.
* @param title - Value label for error messages.
* @param n - Candidate value.
* @param min - Inclusive lower bound.
* @param max - Exclusive upper bound.
* Wrong-type inputs are not separated from out-of-range values here: they still flow through the
* shared `RangeError` path because this is only a throwing wrapper around `inRange(...)`.
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Assert that a bigint stays within one half-open range.
*
* ```ts
* aInRange('x', 2n, 1n, 256n);
* ```
*/
function aInRange(title, n, min, max) {
	if (!inRange(n, min, max)) throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
/**
* Calculates amount of bits in a bigint.
* Same as `n.toString(2).length`
* TODO: merge with nLength in modular
* @param n - Value to inspect.
* @returns Bit length.
* @throws If the value is negative. {@link Error}
* @example
* Measure the bit length of a scalar before serialization.
*
* ```ts
* bitLen(8n);
* ```
*/
function bitLen(n) {
	if (n < _0n$5) throw new Error("expected non-negative bigint, got " + n);
	return n === _0n$5 ? 0 : n.toString(2).length;
}
/**
* Calculate mask for N bits. Not using ** operator with bigints because of old engines.
* Same as BigInt(`0b${Array(i).fill('1').join('')}`)
* @param n - Number of bits. Negative widths are currently passed through to raw bigint shift
*   semantics and therefore produce `-1n`.
* @returns Bitmask value.
* @example
* Calculate mask for N bits.
*
* ```ts
* bitMask(4);
* ```
*/
const bitMask = (n) => {
	asafenumber(n, "n");
	return (_1n$5 << BigInt(n)) - _1n$5;
};
/**
* Validates declared required and optional field types on a plain object.
* Extra keys are intentionally ignored because many callers validate only the subset they use from
* richer option bags or runtime objects.
* This walks field schemas and formats detailed errors, so avoid it on hot paths; use direct
* one-line guards such as `aobject()`, `afunction()`, `abool()`, or `asafenumber()` instead.
* @param object - Object to validate.
* @param fields - Required field types.
* @param optFields - Optional field types.
* @param title - Object label included in thrown errors.
* @throws On wrong argument types. {@link TypeError}
* @example
* Check user options before building a curve helper.
*
* ```ts
* validateObject({ flag: true }, { flag: 'boolean' });
* ```
*/
function validateObject(object, fields = {}, optFields = {}, title = "object") {
	aobject$1(object, title);
	aobject$1(fields, "fields");
	aobject$1(optFields, "optFields");
	function checkField(fieldName, expectedType, isOpt) {
		const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
		const val = object[fieldName];
		if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) throw new TypeError(`${label} is invalid: expected own property`);
		if (isOpt && val === void 0) return;
		const current = typeof val;
		if (current !== expectedType || val === null) throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
	}
	const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
	iter(fields, false);
	iter(optFields, true);
}
//#endregion
//#region @noble/curves/abstract/modular.js
/**
* Utils for modular division and fields.
* Field over 11 is a finite (Galois) field is integer number operations `mod 11`.
* There is no division: it is replaced by modular multiplicative inverse.
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$4 = /* @__PURE__ */ BigInt(0), _1n$4 = /* @__PURE__ */ BigInt(1), _2n$3 = /* @__PURE__ */ BigInt(2);
const _3n$1 = /* @__PURE__ */ BigInt(3), _4n$2 = /* @__PURE__ */ BigInt(4), _5n$1 = /* @__PURE__ */ BigInt(5);
const _7n = /* @__PURE__ */ BigInt(7), _8n$2 = /* @__PURE__ */ BigInt(8), _9n = /* @__PURE__ */ BigInt(9);
const _15n = /* @__PURE__ */ BigInt(15), _16n = /* @__PURE__ */ BigInt(16);
const POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
/**
* @param a - Dividend value.
* @param b - Positive modulus.
* @returns Reduced value in `[0, b)` only when `b` is positive.
* @throws If the modulus is not positive. {@link Error}
* @example
* Normalize a bigint into one field residue.
*
* ```ts
* mod(-1n, 5n);
* ```
*/
function mod(a, b) {
	if (b <= _0n$4) throw new Error("mod: expected positive modulus, got " + b);
	const result = a % b;
	return result >= _0n$4 ? result : b + result;
}
/**
* Efficiently raise num to a power with modular reduction.
* Unsafe in some contexts: uses ladder, so can expose bigint bits.
* Low-level helper: callers that need canonical residues must pass a valid `num` for the chosen
* modulus instead of relying on the `power===0/1` fast paths to normalize it.
* @param num - Base value.
* @param power - Exponent value.
* @param modulo - Reduction modulus.
* @returns Modular exponentiation result.
* @throws If the modulus or exponent is invalid. {@link Error}
* @example
* Raise one bigint to a modular power.
*
* ```ts
* pow(2n, 6n, 11n) // 64n % 11n == 9n
* ```
*/
function pow(num, power, modulo) {
	if (modulo <= _1n$4) throw new Error("pow: expected modulus > 1, got " + modulo);
	if (typeof power !== "bigint") throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
	if (power < _0n$4) throw new Error("invalid exponent, negatives unsupported");
	if (power === _0n$4) return _1n$4;
	if (power === _1n$4) return num;
	let d = num % modulo;
	if (d < _0n$4) d += modulo;
	if (power < POW_WINDOWED_MIN) {
		let p = _1n$4;
		while (power > _0n$4) {
			if (power & _1n$4) p = p * d % modulo;
			d = d * d % modulo;
			power >>= _1n$4;
		}
		return p;
	}
	const digits = [];
	while (power > _0n$4) {
		digits.push(Number(power & _15n));
		power >>= _4n$2;
	}
	const table = new Array(16);
	table[0] = _1n$4;
	table[1] = d;
	for (let i = 2; i < 16; i++) table[i] = table[i - 1] * d % modulo;
	let p = table[digits[digits.length - 1]];
	for (let w = digits.length - 2; w >= 0; w--) {
		p = p * p % modulo;
		p = p * p % modulo;
		p = p * p % modulo;
		p = p * p % modulo;
		const digit = digits[w];
		if (digit !== 0) p = p * table[digit] % modulo;
	}
	return p;
}
/**
* Does `x^(2^power)` mod p. `pow2(30, 4)` == `30^(2^4)`.
* Low-level helper: callers that need canonical residues must pass a valid `x` for the chosen
* modulus; the `power===0` fast path intentionally returns the input unchanged.
* @param x - Base value.
* @param power - Number of squarings.
* @param modulo - Reduction modulus.
* @returns Repeated-squaring result.
* @throws If the exponent is negative. {@link Error}
* @example
* Apply repeated squaring inside one field.
*
* ```ts
* pow2(3n, 2n, 11n);
* ```
*/
function pow2(x, power, modulo) {
	if (modulo <= _1n$4) throw new Error("pow2: expected modulus > 1, got " + modulo);
	if (power < _0n$4) throw new Error("pow2: expected non-negative exponent, got " + power);
	let res = x;
	while (power-- > _0n$4) {
		res *= res;
		res %= modulo;
	}
	return res;
}
/**
* Inverses number over modulo.
* Implemented using the {@link https://brilliant.org/wiki/extended-euclidean-algorithm/ | extended Euclidean algorithm}.
* @param number - Value to invert.
* @param modulo - Modulus greater than 1.
* @returns Multiplicative inverse.
* @throws If the modulus is invalid or the inverse does not exist. {@link Error}
* @example
* Compute one modular inverse with the extended Euclidean algorithm.
*
* ```ts
* invert(3n, 11n);
* ```
*/
function invert(number, modulo) {
	if (number === _0n$4) throw new Error("invert: expected non-zero number");
	if (modulo <= _1n$4) throw new Error("invert: expected modulus > 1, got " + modulo);
	let a = mod(number, modulo);
	let b = modulo;
	let x = _0n$4, u = _1n$4;
	while (a !== _0n$4) {
		const q = b / a;
		const r = b - a * q;
		const m = x - u * q;
		b = a, a = r, x = u, u = m;
	}
	if (b !== _1n$4) throw new Error("invert: does not exist");
	return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
	const F = Fp;
	if (!F.eql(F.sqr(root), n)) throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
	if ((order & _1n$4) === _0n$4) throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp, n) {
	const F = Fp;
	const p1div4 = (F.ORDER + _1n$4) / _4n$2;
	const root = F.pow(n, p1div4);
	assertIsSquare(F, root, n);
	return root;
}
function sqrt5mod8(Fp, n) {
	const F = Fp;
	const p5div8 = (F.ORDER - _5n$1) / _8n$2;
	const n2 = F.mul(n, _2n$3);
	const v = F.pow(n2, p5div8);
	const nv = F.mul(n, v);
	const i = F.mul(F.mul(nv, _2n$3), v);
	const root = F.mul(nv, F.sub(i, F.ONE));
	assertIsSquare(F, root, n);
	return root;
}
function sqrt9mod16(P) {
	const Fp_ = Field(P);
	const tn = tonelliShanks(P);
	const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
	const c2 = tn(Fp_, c1);
	const c3 = tn(Fp_, Fp_.neg(c1));
	const c4 = (P + _7n) / _16n;
	return ((Fp, n) => {
		const F = Fp;
		let tv1 = F.pow(n, c4);
		let tv2 = F.mul(tv1, c1);
		const tv3 = F.mul(tv1, c2);
		const tv4 = F.mul(tv1, c3);
		const e1 = F.eql(F.sqr(tv2), n);
		const e2 = F.eql(F.sqr(tv3), n);
		tv1 = F.cmov(tv1, tv2, e1);
		tv2 = F.cmov(tv4, tv3, e2);
		const e3 = F.eql(F.sqr(tv2), n);
		const root = F.cmov(tv1, tv2, e3);
		assertIsSquare(F, root, n);
		return root;
	});
}
/**
* Tonelli-Shanks square root search algorithm.
* This implementation is variable-time: it searches data-dependently for the first non-residue `Z`
* and for the smallest `i` in the main loop, unlike RFC 9380 Appendix I.4's constant-time shape.
* 1. {@link https://eprint.iacr.org/2012/685.pdf | eprint 2012/685}, page 12
* 2. Square Roots from 1; 24, 51, 10 to Dan Shanks
* @param P - field order
* @returns function that takes field Fp (created from P) and number n
* @throws If the field is too small, non-prime, or the square root does not exist. {@link Error}
* @example
* Construct a square-root helper for primes that need Tonelli-Shanks.
*
* ```ts
* import { Field, tonelliShanks } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const sqrt = tonelliShanks(17n)(Fp, 4n);
* ```
*/
function tonelliShanks(P) {
	if (P < _3n$1) throw new Error("sqrt is not defined for small field");
	aoddModulus(P, "tonelliShanks");
	let Q = P - _1n$4;
	let S = 0;
	while (Q % _2n$3 === _0n$4) {
		Q /= _2n$3;
		S++;
	}
	let Z = _2n$3;
	const _Fp = Field(P);
	while (FpLegendre(_Fp, Z) === 1) if (Z++ > 1e3) throw new Error("Cannot find square root: probably non-prime P");
	if (S === 1) return sqrt3mod4;
	let cc = _Fp.pow(Z, Q);
	const Q1div2 = (Q + _1n$4) / _2n$3;
	return function tonelliSlow(Fp, n) {
		const F = Fp;
		if (F.is0(n)) return n;
		if (FpLegendre(F, n) !== 1) throw new Error("Cannot find square root");
		let M = S;
		let c = F.mul(F.ONE, cc);
		let t = F.pow(n, Q);
		let R = F.pow(n, Q1div2);
		while (!F.eql(t, F.ONE)) {
			if (F.is0(t)) throw new Error("Cannot find square root: probably non-prime P");
			let i = 1;
			let t_tmp = F.sqr(t);
			while (!F.eql(t_tmp, F.ONE)) {
				i++;
				t_tmp = F.sqr(t_tmp);
				if (i === M) throw new Error("Cannot find square root");
			}
			const exponent = _1n$4 << BigInt(M - i - 1);
			const b = F.pow(c, exponent);
			M = i;
			c = F.sqr(b);
			t = F.mul(t, c);
			R = F.mul(R, b);
		}
		return R;
	};
}
/**
* Square root for a finite field. Will try optimized versions first:
*
* 1. P ≡ 3 (mod 4)
* 2. P ≡ 5 (mod 8)
* 3. P ≡ 9 (mod 16)
* 4. Tonelli-Shanks algorithm
*
* Different algorithms can give different roots, it is up to user to decide which one they want.
* For example there is FpSqrtOdd/FpSqrtEven to choose a root by oddness
* (used for hash-to-curve).
* @param P - Field order.
* @returns Square-root helper. The generic fallback inherits Tonelli-Shanks' variable-time
*   behavior and this selector assumes prime-field-style integer moduli.
* @throws If the field is unsupported or the square root does not exist. {@link Error}
* @example
* Choose the square-root helper appropriate for one field modulus.
*
* ```ts
* import { Field, FpSqrt } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const sqrt = FpSqrt(17n)(Fp, 4n);
* ```
*/
function FpSqrt(P) {
	aoddModulus(P, "Fp.sqrt");
	if (P % _4n$2 === _3n$1) return sqrt3mod4;
	if (P % _8n$2 === _5n$1) return sqrt5mod8;
	if (P % _16n === _9n) return sqrt9mod16(P);
	return tonelliShanks(P);
}
/**
* @param num - Value to inspect.
* @param modulo - Field modulus.
* @returns `true` when the least-significant little-endian bit is set.
* @throws If the modulus is invalid for `mod(...)`. {@link Error}
* @example
* Inspect the low bit used by little-endian sign conventions.
*
* ```ts
* isNegativeLE(3n, 11n);
* ```
*/
const isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n$4) === _1n$4;
const FIELD_FIELDS = [
	"create",
	"isValid",
	"is0",
	"neg",
	"inv",
	"sqrt",
	"sqr",
	"eql",
	"add",
	"sub",
	"mul",
	"pow",
	"div",
	"addN",
	"subN",
	"mulN",
	"sqrN"
];
/**
* @param field - Field implementation.
* @returns Validated field. This only checks the arithmetic subset needed by generic helpers; it
*   does not guarantee full runtime-method coverage for serialization, batching, `cmov`, or
*   field-specific extras beyond positive `BYTES` / `BITS`.
* @throws If the field shape or numeric metadata are invalid. {@link Error}
* @example
* Check that a field implementation exposes the operations curve code expects.
*
* ```ts
* import { Field, validateField } from '@noble/curves/abstract/modular.js';
* const Fp = validateField(Field(17n));
* ```
*/
function validateField(field) {
	aobject$1(field, "field");
	if (typeof field.ORDER !== "bigint") throw new TypeError("param \"ORDER\" is invalid: expected bigint, got " + typeof field.ORDER);
	asafenumber(field.BYTES, "BYTES");
	asafenumber(field.BITS, "BITS");
	for (const name of FIELD_FIELDS) afunction(field[name], "field." + name);
	if (field.BYTES < 1 || field.BITS < 1) throw new Error("invalid field: expected BYTES/BITS > 0");
	if (field.ORDER <= _1n$4) throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
	return field;
}
function FpInvertBatch(Fp, nums, passZero = false) {
	validateField(Fp);
	aarray(nums, "nums");
	abool$1(passZero, "passZero");
	const F = Fp;
	const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
	const multipliedAcc = nums.reduce((acc, num, i) => {
		if (F.is0(num)) return acc;
		inverted[i] = acc;
		return F.mul(acc, num);
	}, F.ONE);
	const invertedAcc = F.inv(multipliedAcc);
	nums.reduceRight((acc, num, i) => {
		if (F.is0(num)) return acc;
		inverted[i] = F.mul(acc, inverted[i]);
		return F.mul(acc, num);
	}, invertedAcc);
	return inverted;
}
/**
* Legendre symbol.
* Legendre constant is used to calculate Legendre symbol (a | p)
* which denotes the value of a^((p-1)/2) (mod p).
*
* * (a | p) ≡ 1    if a is a square (mod p), quadratic residue
* * (a | p) ≡ -1   if a is not a square (mod p), quadratic non residue
* * (a | p) ≡ 0    if a ≡ 0 (mod p)
* @param Fp - Field implementation.
* @param n - Value to inspect.
* @returns Legendre symbol.
* @throws If the powered value does not match a valid Legendre symbol. {@link Error}
* @example
* Compute the Legendre symbol of one field element.
*
* ```ts
* import { Field, FpLegendre } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const symbol = FpLegendre(Fp, 4n);
* ```
*/
function FpLegendre(Fp, n) {
	validateField(Fp);
	const F = Fp;
	aoddModulus(F.ORDER, "FpLegendre");
	const p1mod2 = (F.ORDER - _1n$4) / _2n$3;
	const powered = F.pow(n, p1mod2);
	const yes = F.eql(powered, F.ONE);
	const zero = F.eql(powered, F.ZERO);
	const no = F.eql(powered, F.neg(F.ONE));
	if (!yes && !zero && !no) throw new Error("invalid Legendre symbol result");
	return yes ? 1 : zero ? 0 : -1;
}
/**
* @param n - Curve order. Callers are expected to pass a positive order.
* @param nBitLength - Optional cached bit length. Callers are expected to pass a positive cached
*   value when overriding the derived bit length.
* @returns Byte and bit lengths.
* @throws If the order or cached bit length is invalid. {@link Error}
* @example
* Measure the encoding sizes needed for one modulus.
*
* ```ts
* nLength(255n);
* ```
*/
function nLength(n, nBitLength) {
	if (nBitLength !== void 0) anumber$1(nBitLength);
	if (n <= _0n$4) throw new Error("invalid n length: expected positive n, got " + n);
	if (nBitLength !== void 0 && nBitLength < 1) throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
	const bits = bitLen(n);
	if (nBitLength !== void 0 && nBitLength < bits) throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
	const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
	return {
		nBitLength: _nBitLength,
		nByteLength: Math.ceil(_nBitLength / 8)
	};
}
const FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
	ORDER;
	BITS;
	BYTES;
	isLE;
	ZERO = _0n$4;
	ONE = _1n$4;
	_lengths;
	_mod;
	constructor(ORDER, opts = {}) {
		if (ORDER <= _1n$4) throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
		let _nbitLength = void 0;
		this.isLE = false;
		if (opts != null && typeof opts === "object") {
			if (typeof opts.BITS === "number") _nbitLength = opts.BITS;
			if (typeof opts.sqrt === "function") Object.defineProperty(this, "sqrt", {
				value: opts.sqrt,
				enumerable: true
			});
			if (typeof opts.isLE === "boolean") this.isLE = opts.isLE;
			if (opts.allowedLengths) this._lengths = Object.freeze(opts.allowedLengths.slice());
			if (typeof opts.modFromBytes === "boolean") this._mod = opts.modFromBytes;
		}
		const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
		if (nByteLength > 2048) throw new Error("invalid field: expected ORDER of <= 2048 bytes");
		this.ORDER = ORDER;
		this.BITS = nBitLength;
		this.BYTES = nByteLength;
		Object.freeze(this);
	}
	create(num) {
		return mod(num, this.ORDER);
	}
	isValid(num) {
		if (typeof num !== "bigint") throw new TypeError("invalid field element: expected bigint, got " + typeof num);
		return _0n$4 <= num && num < this.ORDER;
	}
	is0(num) {
		return num === _0n$4;
	}
	isValidNot0(num) {
		return !this.is0(num) && this.isValid(num);
	}
	isOdd(num) {
		return (num & _1n$4) === _1n$4;
	}
	neg(num) {
		return mod(-num, this.ORDER);
	}
	eql(lhs, rhs) {
		return lhs === rhs;
	}
	sqr(num) {
		return mod(num * num, this.ORDER);
	}
	add(lhs, rhs) {
		return mod(lhs + rhs, this.ORDER);
	}
	sub(lhs, rhs) {
		return mod(lhs - rhs, this.ORDER);
	}
	mul(lhs, rhs) {
		return mod(lhs * rhs, this.ORDER);
	}
	pow(num, power) {
		return pow(num, power, this.ORDER);
	}
	div(lhs, rhs) {
		return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
	}
	sqrN(num) {
		return num * num;
	}
	addN(lhs, rhs) {
		return lhs + rhs;
	}
	subN(lhs, rhs) {
		return lhs - rhs;
	}
	mulN(lhs, rhs) {
		return lhs * rhs;
	}
	inv(num) {
		return invert(num, this.ORDER);
	}
	sqrt(num) {
		let sqrt = FIELD_SQRT.get(this);
		if (!sqrt) FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
		return sqrt(this, num);
	}
	toBytes(num) {
		return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
	}
	fromBytes(bytes, skipValidation = false) {
		abytes$1(bytes);
		const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
		if (allowedLengths) {
			if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
			const padded = new Uint8Array(BYTES);
			padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
			bytes = padded;
		}
		if (bytes.length !== BYTES) throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
		let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
		if (modFromBytes) scalar = mod(scalar, ORDER);
		if (!skipValidation) {
			if (!this.isValid(scalar)) throw new Error("invalid field element: outside of range 0..ORDER");
		}
		return scalar;
	}
	invertBatch(lst) {
		return FpInvertBatch(this, lst, true);
	}
	cmov(a, b, condition) {
		abool$1(condition, "condition");
		return condition ? b : a;
	}
};
/**
* Creates a finite field. Major performance optimizations:
* * 1. Denormalized operations like mulN instead of mul.
* * 2. Identical object shape: never add or remove keys.
* * 3. Frozen stable object shape; the lazy sqrt cache lives in a module-level `WeakMap`.
* Fragile: always run a benchmark on a change.
* Security note: operations and low-level serializers like `toBytes` don't check `isValid` for
* all elements for performance and protocol-flexibility reasons; callers are responsible for
* supplying valid elements when they need canonical field behavior.
* This is low-level code, please make sure you know what you're doing.
*
* Note about field properties:
* * CHARACTERISTIC p = prime number, number of elements in main subgroup.
* * ORDER q = similar to cofactor in curves, may be composite `q = p^m`.
*
* @param ORDER - field order, probably prime, or could be composite
* @param opts - Field options such as bit length or endianness. See {@link FieldOpts}.
* @returns Frozen field instance with a stable object shape. This wrapper forwards `opts` straight
*   into `_Field`, so it inherits `_Field`'s assumptions about cached sizes and `allowedLengths`.
* @example
* Construct one prime field with optional overrides.
*
* ```ts
* Field(11n);
* ```
*/
function Field(ORDER, opts = {}) {
	Object.freeze(_Field.prototype);
	return new _Field(ORDER, opts);
}
//#endregion
//#region @noble/curves/abstract/curve.js
/**
* Methods for elliptic curve multiplication by scalars.
* Contains wNAF-based ScalarMultiplier, pippenger.
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$3 = /* @__PURE__ */ BigInt(0);
const _1n$3 = /* @__PURE__ */ BigInt(1);
const _4n$1 = /* @__PURE__ */ BigInt(4);
const BLIND_BYTES = 16;
const BLIND_BITS = 128;
const FW_WINDOW = 5;
const TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
/**
* Validates the static surface of a point constructor.
* This is only a cheap sanity check for the constructor hooks and fields consumed by generic
* factories; it does not certify `BASE`/`ZERO` semantics or prove the curve implementation itself.
* @param Point - Runtime point constructor.
* @throws On missing constructor hooks or malformed field metadata. {@link TypeError}
* @example
* Check that one point constructor exposes the static hooks generic helpers need.
*
* ```ts
* import { ed25519 } from '@noble/curves/ed25519.js';
* import { validatePointCons } from '@noble/curves/abstract/curve.js';
* validatePointCons(ed25519.Point);
* ```
*/
function validatePointCons(Point) {
	const pc = Point;
	if (typeof pc !== "function") throw new TypeError("\"Point\" expected constructor, got type=" + typeof Point);
	afunction(pc.fromAffine, "Point.fromAffine");
	afunction(pc.fromBytes, "Point.fromBytes");
	afunction(pc.fromHex, "Point.fromHex");
	aobject$1(pc.BASE, "Point.BASE");
	aobject$1(pc.ZERO, "Point.ZERO");
	validateField(pc.Fp);
	validateField(pc.Fn);
}
/**
* Takes a bunch of Projective Points but executes only one
* inversion on all of them. Inversion is very slow operation,
* so this improves performance massively.
* Optimization: converts a list of projective points to a list of identical points with Z=1.
* Input points are left unchanged; the normalized points are returned as fresh instances.
* @param c - Point constructor.
* @param points - Projective points.
* @returns Fresh projective points reconstructed from normalized affine coordinates.
* @example
* Batch-normalize projective points with a single shared inversion.
*
* ```ts
* import { normalizeZ } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const points = normalizeZ(p256.Point, [p256.Point.BASE, p256.Point.BASE.double()]);
* ```
*/
function normalizeZ(c, points) {
	validatePointCons(c);
	validateMSMPoints(points, c);
	const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
	return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
	if (!Number.isSafeInteger(W) || W < min || W > bits) throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
	const bytes = numPoints * (4 * fpBytes + 128);
	if (bytes > TABLE_BYTES_MAX) throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
/**
* Probes an RNG once, at construction time: returns `undefined` when it is unavailable —
* throws or returns malformed bytes — so callers can downgrade to their unblinded /
* deterministic constant-time fallback. Blinding is defense-in-depth (DPA/template
* hardening), not a correctness or key-secrecy requirement, so availability-based
* downgrade is acceptable.
*
* The downgrade decision is deliberately static. After a successful probe the RNG becomes
* part of the trusted contract: later misbehavior must fail closed in per-call validation
* (throw), never downgrade — a dynamic fallback would let a tampered RNG silently strip
* blinding on demand. A probe can only ever classify broken environments, not adversarial
* RNGs: a stateful RNG can always behave while probed and misbehave later.
* @param randomBytes - RNG to probe, or `undefined` when the environment provides none.
* @param length - Byte length requested from the probe call.
* @returns The RNG when the probe produced `length` valid bytes; `undefined` otherwise.
* @example
* Probe an RNG once before enabling scalar blinding.
*
* ```ts
* import { probeRandomBytes } from '@noble/curves/abstract/curve.js';
* import { randomBytes } from '@noble/hashes/utils.js';
* const rng = probeRandomBytes(randomBytes, 16);
* ```
*/
function probeRandomBytes(randomBytes, length) {
	if (randomBytes === void 0) return void 0;
	afunction(randomBytes, "randomBytes");
	try {
		const probe = randomBytes(length);
		if (!isBytes$1(probe) || probe.length !== length) return void 0;
	} catch {
		return;
	}
	return randomBytes;
}
function validateMSMPoints(points, c) {
	aarray(points, "points");
	points.forEach((p, i) => {
		if (!(p instanceof c)) throw new Error("invalid point at index " + i);
	});
}
function validateMSMScalars(scalars, field, maxScalar) {
	if (!Array.isArray(scalars)) throw new Error("array of scalars expected");
	scalars.forEach((s, i) => {
		if (!(maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar)) throw new Error("invalid scalar at index " + i);
	});
}
const pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P) {
	return pointWindowSizes.get(P) || 1;
}
/** Table of odd multiples [1P, 3P, ..., (2⋅size−1)P]; width-W wNAF uses size = 2^(W−2). */
function oddMultiples(p, size) {
	const dbl = p.double();
	const t = [p];
	for (let j = 1; j < size; j++) t.push(t[j - 1].add(dbl));
	return t;
}
/**
* Width-W wNAF signed-digit recoding (W >= 2), LSB-first: digits are 0 or odd with
* |digit| < 2^(W−1); nonzero density ~1/(W+1) (a nonzero digit is followed by W−1 zeros).
*/
function wnafDigits(n, W) {
	const size = 2 ** W;
	const half = size / 2;
	const mask = BigInt(size - 1);
	const d = [];
	while (n > _0n$3) {
		let w = 0;
		if (n & _1n$3) {
			w = Number(n & mask);
			if (w >= half) w -= size;
			n -= BigInt(w);
		}
		d.push(w);
		n >>= _1n$3;
	}
	return d;
}
/**
* Fixed-position signed-window recoding for precomputed wNAF: `n = Σ digits[w]⋅2^(w⋅W)` with
* digits in `[−2^(W−1)+1, 2^(W−1)]`. Digit count is fixed by `windows` (callers reserve one
* extra window for the final carry), so recoding length does not depend on the scalar.
*/
function signedWindowDigits(n, W, windows) {
	const size = 2 ** W;
	const half = size / 2;
	const mask = BigInt(size - 1);
	const shiftBy = BigInt(W);
	const d = [];
	for (let w = 0; w < windows; w++) {
		let v = Number(n & mask);
		n >>= shiftBy;
		if (v > half) {
			v -= size;
			n += _1n$3;
		}
		d.push(v);
	}
	if (n !== _0n$3) throw new Error("invalid wnaf");
	return d;
}
/**
* Shared vartime walk over per-scalar wNAF digit streams: one doubling of a single shared
* accumulator per bit position of the longest recoding, one signed table addition per
* nonzero digit. `tables[i]` must hold the odd multiples of the i-th point.
*/
function wnafWalk(zero, tables, digits) {
	let max = 0;
	for (const d of digits) max = Math.max(max, d.length);
	let acc = zero;
	for (let bit = max - 1; bit >= 0; bit--) {
		if (bit !== max - 1) acc = acc.double();
		for (let i = 0; i < digits.length; i++) {
			const w = digits[i][bit];
			if (w) {
				const item = tables[i][Math.abs(w) - 1 >> 1];
				acc = acc.add(w < 0 ? item.negate() : item);
			}
		}
	}
	return acc;
}
/**
* Elliptic curve multiplication of Point by scalar.
* Routes between cached-table, fixed-window, and one-shot wNAF paths; entry points validate
* their own scalars (`mulCT`/`mulCTBlinded`: `1 <= s < Fn.ORDER`; `mulUnsafe`: up to the
* `Fn.ORDER^4` DoS cap via {@link mulAddUnsafe}).
* Table generation is expensive and happens on first call of `multiply()`
* (or eagerly via `precompute(W, false)`). By default, `BASE` point is precomputed.
*
* Cached algorithm is signed fixed-window wNAF:
* - table stores, for every window w, the multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P` — all doublings
*   are baked in, so a multiplication is exactly one table addition per window
* - window count is fixed (`ceil(bits/W) + 1`), so the point-operation count is scalar-independent
*   (basis of the constant-time path)
* - for a 256-bit curve and W=6: 44⋅32 = 1408 table points, 44 additions per multiply
* - secret scalars are additionally blinded (see {@link ScalarMultiplier.mulCTBlinded}), which
*   widens tables by 128 bits
* @param Point - Point constructor.
* @param randomBytes - RNG used for scalar blinding; required by the blinded secret path.
* @example
* Elliptic curve multiplication of Point by scalar.
*
* ```ts
* import { ScalarMultiplier } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const mul = new ScalarMultiplier(p256.Point);
* ```
*/
var ScalarMultiplier = class {
	Point;
	BASE;
	ZERO;
	randomBytes;
	wnafPrecomputes = /* @__PURE__ */ new WeakMap();
	baseCanBeBlinded;
	bits;
	constructor(Point, randomBytes) {
		validatePointCons(Point);
		this.randomBytes = probeRandomBytes(randomBytes, BLIND_BYTES);
		this.Point = Point;
		this.BASE = Point.BASE;
		this.ZERO = Point.ZERO;
		this.bits = Point.Fn.BITS;
	}
	/**
	* Creates a signed fixed-window wNAF precomputation table: for every window w, the
	* multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
	* so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
	* window absorbs the final carry of signed-digit recoding.
	* For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
	* @param point - Point instance
	* @param W - window size
	* @param bits - scalar bitlength the table must cover
	*/
	buildWnafTable(point, W, bits) {
		const windows = Math.ceil(bits / W) + 1;
		const half = 2 ** (W - 1);
		const comp = [];
		let base = point;
		for (let w = 0; w < windows; w++) {
			let acc = base;
			for (let i = 0; i < half; i++) {
				comp.push(acc);
				acc = acc.add(base);
			}
			base = comp[comp.length - 1].double();
		}
		return {
			W,
			bits,
			windows,
			comp
		};
	}
	/**
	* Implements ec multiplication using precomputed signed fixed-window wNAF tables.
	* Constant-time: fixed window count with one table addition per window — zero digits feed
	* the fake accumulator — and no doublings; the lookup scans the whole window slice.
	* Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
	* {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
	* signedWindowDigits throws if `n` exceeds the table.
	* @returns real and fake (for const-time) points
	*/
	wnafCachedCT(precomputes, n) {
		const { W, windows, comp } = precomputes;
		const half = 2 ** (W - 1);
		const digits = signedWindowDigits(n, W, windows);
		let p = this.ZERO;
		let f = this.BASE;
		for (let w = 0; w < windows; w++) {
			const digit = digits[w];
			const start = w * half;
			const idx = Math.abs(digit) - 1;
			let sel = comp[start];
			for (let i = 1; i < half; i++) sel = i === idx ? comp[start + i] : sel;
			const neg = sel.negate();
			if (digit === 0) f = f.add(comp[start]);
			else p = p.add(digit < 0 ? neg : sel);
		}
		return {
			p,
			f
		};
	}
	getWnafPrecomputes(W, point, bits, transform) {
		let entries = this.wnafPrecomputes.get(point);
		let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
		if (!comp) {
			comp = this.buildWnafTable(point, W, bits);
			if (typeof transform === "function") comp = {
				...comp,
				comp: transform(comp.comp)
			};
			if (!entries) {
				entries = [];
				this.wnafPrecomputes.set(point, entries);
			}
			entries.push(comp);
		}
		return comp;
	}
	assertPoint(point) {
		if (!(point instanceof this.Point)) throw new TypeError("\"point\" expected Point instance, got type=" + typeof point);
	}
	validateMulInput(point, scalar) {
		this.assertPoint(point);
		if (!inRange(scalar, _1n$3, this.Point.Fn.ORDER)) throw new Error("invalid scalar");
	}
	runCT(point, n, bits, transform) {
		const W = getWindowSize(point);
		if (W === 1) return this.fixedWindowCT(point, n, bits);
		return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
	}
	mulCT(point, scalar, transform) {
		this.validateMulInput(point, scalar);
		return this.runCT(point, scalar, this.bits, transform);
	}
	mulCTBlinded(point, scalar, transform) {
		this.validateMulInput(point, scalar);
		if (this.randomBytes === void 0) throw new Error("randomBytes is required for scalar blinding");
		const bits = this.Point.Fn.BITS + BLIND_BITS;
		const blind = this.randomBytes(BLIND_BYTES);
		if (!isBytes$1(blind) || blind.length !== BLIND_BYTES) throw new Error("randomBytes returned invalid byte array");
		blind[0] = blind[0] & 63 | 128;
		const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
		return this.runCT(point, n, bits, transform);
	}
	/**
	* Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
	* A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
	* far cheaper to build for a single use. The point-operation sequence is independent of `n`:
	* build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
	* every table entry, and one addition (adds the identity when the window digit is 0 — never
	* skipped).
	*
	* `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
	* add), which holds for the Weierstrass/Edwards point types used here. The table is left in
	* projective form (no normalizeZ): normalizing this small a table costs more than the
	* mixed-add savings it would buy for a single multiply.
	* @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
	* (this path needs no fake accumulator — its op-count is already scalar-independent).
	*/
	fixedWindowCT(point, n, bits) {
		const W = FW_WINDOW;
		const size = 1 << W;
		const mask = bitMask(W);
		const table = new Array(size);
		table[0] = this.ZERO;
		for (let i = 1; i < size; i++) table[i] = table[i - 1].add(point);
		const windows = Math.ceil(bits / W);
		let acc = this.ZERO;
		for (let window = windows - 1; window >= 0; window--) {
			if (window !== windows - 1) for (let d = 0; d < W; d++) acc = acc.double();
			const digit = Number(n >> BigInt(window * W) & mask);
			let sel = table[0];
			for (let i = 1; i < size; i++) sel = i === digit ? table[i] : sel;
			acc = acc.add(sel);
		}
		return {
			p: acc,
			f: acc
		};
	}
	shouldBlind(point, cofactor) {
		if (this.randomBytes === void 0) return false;
		if (cofactor === _1n$3) return true;
		if (point !== this.BASE) return false;
		if (this.baseCanBeBlinded === void 0) this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
		return this.baseCanBeBlinded;
	}
	mulSecret(point, scalar, cofactor, transform) {
		return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
	}
	mulUnsafe(point, scalar, transform) {
		this.assertPoint(point);
		if (!isPosBig(scalar)) throw new Error("invalid scalar");
		const W = getWindowSize(point);
		if (W === 1 || scalar >= this.Point.Fn.ORDER) return mulAddUnsafe(this.Point, [point], [scalar], true);
		const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
		return this.wnafCachedCT(precomputes, scalar).p;
	}
	setWindowSize(point, W) {
		this.assertPoint(point);
		validateW(W, this.bits);
		validateTableBytes((Math.ceil((this.bits + BLIND_BITS) / W) + 1) * 2 ** (W - 1), this.Point.Fp.BYTES);
		pointWindowSizes.set(point, W);
		this.wnafPrecomputes.delete(point);
	}
	hasWindowSize(point) {
		return getWindowSize(point) !== 1;
	}
};
/**
* Combined multi-scalar multiplication `Σ scalars[i]⋅points[i]` via interleaved width-4 wNAF
* (Strauss–Shamir). Every input gets its own table of odd multiples `[1P, 3P, 5P, 7P]` and
* signed-digit recoding, but all walks share one doubling chain, so total cost is
* `~bits` doublings + `L⋅bits/5` additions instead of `L⋅bits` doublings for separate
* multiplications. Intended for the 2-4 point shapes of signature verification
* (`R = u1⋅G + u2⋅P`); use {@link pippenger} for larger batches.
*
* Not constant-time: only for public inputs. Scalars must satisfy `0 <= s < Fn.ORDER`;
* fold negative signs into the points before calling.
* @param c - Point constructor.
* @param points - Array of curve points.
* @param scalars - Array of non-negative scalars, same length as points.
* @param allowOversized - Replace the `s < Fn.ORDER` scalar check with a `Fn.ORDER^4` DoS cap.
*   Off by default. For scalars that must NOT be reduced mod ORDER: torsion checks
*   (`Fn.ORDER⋅P ≟ O`) and cofactor-clearing multiples. Walk length grows with `bitLen(s)`.
* @returns Combined multiplication result; identity for empty input.
* @throws If the point set or scalar set is invalid. {@link Error}
* @example
* Combined multi-scalar multiplication via Strauss–Shamir.
*
* ```ts
* import { mulAddUnsafe } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const G = p256.Point.BASE;
* const R = mulAddUnsafe(p256.Point, [G, G.double()], [2n, 3n]); // 2⋅G + 3⋅(2⋅G)
* ```
*/
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
	validatePointCons(c);
	validateMSMPoints(points, c);
	abool$1(allowOversized, "allowOversized");
	validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n$1 : void 0);
	if (points.length !== scalars.length) throw new Error("arrays of points and scalars must have equal length");
	const tables = points.map((p) => oddMultiples(p, 4));
	const digits = scalars.map((n) => wnafDigits(n, 4));
	return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE) {
	if (field) {
		if (field.ORDER !== order) throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
		validateField(field);
		return field;
	} else return Field(order, { isLE });
}
/**
* Validates basic CURVE shape and field membership, then creates fields.
* This does not prove that the generator is on-curve, that subgroup/order data are consistent, or
* that the curve equation itself is otherwise sane.
* @param type - Curve family.
* @param CURVE - Curve parameters.
* @param curveOpts - Optional field overrides. See {@link FpFn}:
*   - `Fp` (optional): Optional base-field override.
*   - `Fn` (optional): Optional scalar-field override.
* @param FpFnLE - Whether field encoding is little-endian.
* @returns Frozen curve parameters and fields.
* @throws If the curve parameters or field overrides are invalid. {@link Error}
* @example
* Build curve fields from raw constants before constructing a curve instance.
*
* ```ts
* const curve = createCurveFields('weierstrass', {
*   p: 17n,
*   n: 19n,
*   h: 1n,
*   a: 2n,
*   b: 2n,
*   Gx: 5n,
*   Gy: 1n,
* });
* ```
*/
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
	if (type !== "weierstrass" && type !== "edwards") throw new Error("expected curve type \"weierstrass\" or \"edwards\"");
	if (FpFnLE === void 0) FpFnLE = type === "edwards";
	if (!CURVE || typeof CURVE !== "object") throw new Error(`expected valid ${type} CURVE object`);
	validateObject(curveOpts);
	for (const p of [
		"p",
		"n",
		"h"
	]) {
		const val = CURVE[p];
		if (!(isPosBig(val) && val !== _0n$3)) throw new Error(`CURVE.${p} must be positive bigint`);
	}
	const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
	const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
	const params = [
		"Gx",
		"Gy",
		"a",
		type === "weierstrass" ? "b" : "d"
	];
	for (const p of params) if (!Fp.isValid(CURVE[p])) throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
	CURVE = Object.freeze(Object.assign({}, CURVE));
	return {
		CURVE,
		Fp,
		Fn
	};
}
/**
* @param randomSecretKey - Secret-key generator.
* @param getPublicKey - Public-key derivation helper.
* @returns Keypair generator.
* @example
* Build a `keygen()` helper from existing secret-key and public-key primitives.
*
* ```ts
* import { createKeygen } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const keygen = createKeygen(p256.utils.randomSecretKey, p256.getPublicKey);
* const pair = keygen();
* ```
*/
function createKeygen(randomSecretKey, getPublicKey) {
	return function keygen(seed) {
		const secretKey = randomSecretKey(seed);
		return {
			secretKey,
			publicKey: getPublicKey(secretKey)
		};
	};
}
//#endregion
//#region @noble/curves/abstract/edwards.js
/**
* Twisted Edwards curve. The formula is: ax² + y² = 1 + dx²y².
* For design rationale of types / exports, see weierstrass module documentation.
* Untwisted Edwards curves exist, but they aren't used in real-world protocols.
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$2 = /* @__PURE__ */ BigInt(0), _1n$2 = /* @__PURE__ */ BigInt(1), _2n$2 = /* @__PURE__ */ BigInt(2), _4n = /* @__PURE__ */ BigInt(4), _8n$1 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp, CURVE, x, y) {
	const x2 = Fp.sqr(x);
	const y2 = Fp.sqr(y);
	const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
	const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
	return Fp.eql(left, right);
}
/**
* @param params - Curve parameters. See {@link EdwardsOpts}.
* @param extraOpts - Optional helpers and overrides. See {@link EdwardsExtraOpts}.
* @returns Edwards point constructor. Generator validation here only checks
*   that `(Gx, Gy)` satisfies the affine Edwards equation.
*   RFC 8032 base-point constraints like `B != (0,1)` and `[L]B = 0`
*   are left to the caller's chosen parameters, since eager subgroup
*   validation here adds about 10-15ms to heavyweight imports like ed448.
*   The returned constructor also eagerly marks `Point.BASE` for W=6
*   precompute caching. Some code paths still assume
*   `Fp.BYTES === Fn.BYTES`, so mismatched byte lengths are not fully audited here.
* @throws If the curve parameters or Edwards overrides are invalid. {@link Error}
* @example
* ```ts
* import { edwards } from '@noble/curves/abstract/edwards.js';
* import { jubjub } from '@noble/curves/misc.js';
* // Build a point constructor from explicit curve parameters, then use its base point.
* const Point = edwards(jubjub.Point.CURVE());
* Point.BASE.toHex();
* ```
*/
function edwards(params, extraOpts = {}) {
	validateObject(extraOpts, {}, {}, "extraOpts");
	const opts = extraOpts;
	const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
	const { Fp, Fn } = validated;
	let CURVE = validated.CURVE;
	const { h: cofactor } = CURVE;
	if (FpLegendre(Fp, CURVE.a) !== 1) throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
	if (FpLegendre(Fp, CURVE.d) !== -1) throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
	validateObject(opts, {}, {
		uvRatio: "function",
		randomBytes: "function"
	});
	const randomBytes = opts.randomBytes === void 0 ? randomBytes$1 : opts.randomBytes;
	const MASK = _2n$2 << BigInt(Fp.BYTES * 8) - _1n$2;
	function isOdd(n) {
		if (!Fp.isOdd) throw new Error("Field does not have .isOdd()");
		return Fp.isOdd(n);
	}
	const uvRatio = opts.uvRatio === void 0 ? (u, v) => {
		try {
			return {
				isValid: true,
				value: Fp.sqrt(Fp.div(u, v))
			};
		} catch (e) {
			return {
				isValid: false,
				value: _0n$2
			};
		}
	} : opts.uvRatio;
	if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy)) throw new Error("bad curve params: generator point");
	const mulA = Fp.eql(CURVE.a, Fp.neg(Fp.ONE)) ? (x) => Fp.neg(x) : Fp.eql(CURVE.a, Fp.ONE) ? (x) => x : (x) => Fp.mul(CURVE.a, x);
	/**
	* Asserts coordinate is valid: 0 <= n < MASK.
	* Coordinates >= Fp.ORDER are allowed for zip215.
	*/
	function acoord(title, n, banZero = false) {
		const min = banZero ? _1n$2 : _0n$2;
		aInRange("coordinate " + title, n, min, MASK);
		return n;
	}
	function aedpoint(other) {
		if (!(other instanceof Point)) throw new Error("EdwardsPoint expected");
	}
	class Point {
		static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE, Fp.mul(CURVE.Gx, CURVE.Gy));
		static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ONE, Fp.ZERO);
		static Fp = Fp;
		static Fn = Fn;
		X;
		Y;
		Z;
		T;
		constructor(X, Y, Z, T) {
			this.X = acoord("x", X);
			this.Y = acoord("y", Y);
			this.Z = acoord("z", Z, true);
			this.T = acoord("t", T);
			Object.freeze(this);
		}
		static CURVE() {
			return CURVE;
		}
		/**
		* Create one extended Edwards point from affine coordinates.
		* Does NOT validate that the point is on-curve or torsion-free.
		* Use `.assertValidity()` on adversarial inputs.
		*/
		static fromAffine(p) {
			if (p instanceof Point) throw new Error("extended point not allowed");
			const { x, y } = p || {};
			acoord("x", x);
			acoord("y", y);
			return new Point(x, y, Fp.ONE, Fp.mul(x, y));
		}
		static fromBytes(bytes, zip215 = false) {
			const len = Fp.BYTES;
			const { a, d } = CURVE;
			bytes = copyBytes$1(abytes$1(bytes, len, "point"));
			abool$1(zip215, "zip215");
			const normed = copyBytes$1(bytes);
			const lastByte = bytes[len - 1];
			normed[len - 1] = lastByte & -129;
			const y = bytesToNumberLE(normed);
			const max = zip215 ? MASK : Fp.ORDER;
			aInRange("point.y", y, _0n$2, max);
			const y2 = Fp.sqr(y);
			const u = Fp.sub(y2, Fp.ONE);
			const v = Fp.sub(Fp.mulN(d, y2), a);
			let { isValid, value: x } = uvRatio(u, v);
			if (!isValid) throw new Error("bad point: invalid y coordinate");
			const isXOdd = isOdd(x);
			const isLastByteOdd = (lastByte & 128) !== 0;
			if (!zip215 && Fp.is0(x) && isLastByteOdd) throw new Error("bad point: x=0 and x_0=1");
			if (isLastByteOdd !== isXOdd) x = Fp.neg(x);
			return Point.fromAffine({
				x,
				y
			});
		}
		static fromHex(hex, zip215 = false) {
			return Point.fromBytes(hexToBytes$1(hex), zip215);
		}
		get x() {
			return this.toAffine().x;
		}
		get y() {
			return this.toAffine().y;
		}
		precompute(windowSize = 6, isLazy = true) {
			wnaf.setWindowSize(this, windowSize);
			if (!isLazy) this.multiply(_2n$2);
			return this;
		}
		assertValidity() {
			const p = this;
			const { a, d } = CURVE;
			if (p.is0()) throw new Error("bad point: ZERO");
			const { X, Y, Z, T } = p;
			const X2 = Fp.sqr(X);
			const Y2 = Fp.sqr(Y);
			const Z2 = Fp.sqr(Z);
			const Z4 = Fp.sqr(Z2);
			const aX2 = Fp.mul(X2, a);
			const left = Fp.mul(Fp.add(aX2, Y2), Z2);
			const right = Fp.add(Z4, Fp.mul(d, Fp.mul(X2, Y2)));
			if (!Fp.eql(left, right)) throw new Error("bad point: equation left != right (1)");
			const XY = Fp.mul(X, Y);
			const ZT = Fp.mul(Z, T);
			if (!Fp.eql(XY, ZT)) throw new Error("bad point: equation left != right (2)");
		}
		equals(other) {
			aedpoint(other);
			const { X: X1, Y: Y1, Z: Z1 } = this;
			const { X: X2, Y: Y2, Z: Z2 } = other;
			const X1Z2 = Fp.mul(X1, Z2);
			const X2Z1 = Fp.mul(X2, Z1);
			const Y1Z2 = Fp.mul(Y1, Z2);
			const Y2Z1 = Fp.mul(Y2, Z1);
			return Fp.eql(X1Z2, X2Z1) && Fp.eql(Y1Z2, Y2Z1);
		}
		is0() {
			return this.equals(Point.ZERO);
		}
		negate() {
			return new Point(Fp.neg(this.X), this.Y, this.Z, Fp.neg(this.T));
		}
		double() {
			const { X: X1, Y: Y1, Z: Z1 } = this;
			const A = Fp.sqr(X1);
			const B = Fp.sqr(Y1);
			const C = Fp.mul(Fp.sqr(Z1), _2n$2);
			const D = mulA(A);
			const x1y1 = Fp.addN(X1, Y1);
			const E = Fp.sub(Fp.subN(Fp.sqr(x1y1), A), B);
			const G = Fp.addN(D, B);
			const F = Fp.subN(G, C);
			const H = Fp.subN(D, B);
			const X3 = Fp.mul(E, F);
			const Y3 = Fp.mul(G, H);
			const T3 = Fp.mul(E, H);
			const Z3 = Fp.mul(F, G);
			return new Point(X3, Y3, Z3, T3);
		}
		add(other) {
			aedpoint(other);
			const { d } = CURVE;
			const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
			const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
			const A = Fp.mul(X1, X2);
			const B = Fp.mul(Y1, Y2);
			const C = Fp.mul(Fp.mulN(T1, d), T2);
			const D = Fp.mul(Z1, Z2);
			const E = Fp.sub(Fp.subN(Fp.mulN(Fp.addN(X1, Y1), Fp.addN(X2, Y2)), A), B);
			const F = Fp.subN(D, C);
			const G = Fp.addN(D, C);
			const H = Fp.sub(B, mulA(A));
			const X3 = Fp.mul(E, F);
			const Y3 = Fp.mul(G, H);
			const T3 = Fp.mul(E, H);
			const Z3 = Fp.mul(F, G);
			return new Point(X3, Y3, Z3, T3);
		}
		subtract(other) {
			aedpoint(other);
			return this.add(other.negate());
		}
		multiply(scalar) {
			if (!Fn.isValidNot0(scalar)) throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
			const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
			return normalize([p, f])[0];
		}
		multiplyUnsafe(scalar) {
			if (!Fn.isValid(scalar)) throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
			if (scalar === _0n$2) return Point.ZERO;
			if (this.is0() || scalar === _1n$2) return this;
			return wnaf.mulUnsafe(this, scalar, normalize);
		}
		isSmallOrder() {
			return this.clearCofactor().is0();
		}
		isTorsionFree() {
			return wnaf.mulUnsafe(this, CURVE.n).is0();
		}
		toAffine(invertedZ) {
			const p = this;
			let iz = invertedZ;
			if (iz != null && typeof iz !== "bigint") throw new TypeError("\"invertedZ\" expected bigint, got type=" + typeof iz);
			const { X, Y, Z } = p;
			const is0 = p.is0();
			if (iz == null) iz = is0 ? Fp.create(_8n$1) : Fp.inv(Z);
			const x = Fp.mul(X, iz);
			const y = Fp.mul(Y, iz);
			const zz = Fp.mul(Z, iz);
			if (is0) return {
				x: Fp.ZERO,
				y: Fp.ONE
			};
			if (!Fp.eql(zz, Fp.ONE)) throw new Error("invZ was invalid");
			return {
				x,
				y
			};
		}
		clearCofactor() {
			if (cofactor === _1n$2) return this;
			if (cofactor === _2n$2) return this.double();
			if (cofactor === _4n) return this.double().double();
			if (cofactor === _8n$1) return this.double().double().double();
			return this.multiplyUnsafe(cofactor);
		}
		toBytes() {
			const { x, y } = this.toAffine();
			const bytes = Fp.toBytes(y);
			bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0;
			return bytes;
		}
		toHex() {
			return bytesToHex$1(this.toBytes());
		}
		toString() {
			return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
		}
	}
	const normalize = (points) => normalizeZ(Point, points);
	const wnaf = new ScalarMultiplier(Point, randomBytes);
	if (wnaf.bits >= 6) Point.BASE.precompute(6);
	Object.freeze(Point.prototype);
	Object.freeze(Point);
	return Point;
}
/**
* Initializes EdDSA signatures over given Edwards curve.
* @param Point - Edwards point constructor.
* @param cHash - Hash function.
* @param eddsaOpts - Optional signature helpers. See {@link EdDSAOpts}.
* @returns EdDSA helper namespace.
* @throws If the hash function, options, or derived point operations are invalid. {@link Error}
* @example
* Initializes EdDSA signatures over given Edwards curve.
*
* ```ts
* import { eddsa } from '@noble/curves/abstract/edwards.js';
* import { jubjub } from '@noble/curves/misc.js';
* import { sha512 } from '@noble/hashes/sha2.js';
* const sigs = eddsa(jubjub.Point, sha512);
* const { secretKey, publicKey } = sigs.keygen();
* const msg = new TextEncoder().encode('hello noble');
* const sig = sigs.sign(msg, secretKey);
* const isValid = sigs.verify(sig, msg, publicKey);
* ```
*/
function eddsa(Point, cHash, eddsaOpts = {}) {
	validatePointCons(Point);
	if (typeof cHash !== "function") throw new Error("\"hash\" function param is required");
	const hash = cHash;
	const opts = eddsaOpts;
	validateObject(opts, {}, {
		adjustScalarBytes: "function",
		randomBytes: "function",
		domain: "function",
		prehash: "function",
		zip215: "boolean",
		mapToCurve: "function",
		toMontgomery: "function",
		toMontgomerySecret: "function"
	});
	const { prehash } = opts;
	const { BASE, Fp, Fn } = Point;
	const outputLen = hash.outputLen;
	const expectedLen = 2 * Fp.BYTES;
	if (outputLen !== void 0) {
		asafenumber(outputLen, "hash.outputLen");
		if (outputLen !== expectedLen) throw new Error(`hash.outputLen must be ${expectedLen}, got ${outputLen}`);
	}
	const randomBytes = opts.randomBytes === void 0 ? randomBytes$1 : opts.randomBytes;
	const toMontgomery = opts.toMontgomery;
	const toMontgomerySecret = opts.toMontgomerySecret;
	const adjustScalarBytes = opts.adjustScalarBytes === void 0 ? (bytes) => bytes : opts.adjustScalarBytes;
	const domain = opts.domain === void 0 ? (data, ctx, phflag) => {
		abool$1(phflag, "phflag");
		if (ctx.length || phflag) throw new Error("Contexts/pre-hash are not supported");
		return data;
	} : opts.domain;
	function modN_LE(hash) {
		return Fn.create(bytesToNumberLE(hash));
	}
	function getPrivateScalar(key) {
		const len = lengths.secretKey;
		abytes$1(key, lengths.secretKey, "secretKey");
		const hashed = abytes$1(hash(key), 2 * len, "hashedSecretKey");
		const head = adjustScalarBytes(hashed.slice(0, len));
		return {
			head,
			prefix: hashed.slice(len, 2 * len),
			scalar: modN_LE(head)
		};
	}
	/** Convenience method that creates public key from scalar. RFC8032 5.1.5
	* Also exposes the derived scalar/prefix tuple and point form reused by sign().
	*/
	function getExtendedPublicKey(secretKey) {
		const { head, prefix, scalar } = getPrivateScalar(secretKey);
		const point = BASE.multiply(scalar);
		return {
			head,
			prefix,
			scalar,
			point,
			pointBytes: point.toBytes()
		};
	}
	/** Calculates EdDSA pub key. RFC8032 5.1.5. */
	function getPublicKey(secretKey) {
		return getExtendedPublicKey(secretKey).pointBytes;
	}
	function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
		const msg = concatBytes(...msgs);
		return modN_LE(hash(domain(msg, abytes$1(context, void 0, "context"), !!prehash)));
	}
	/** Signs message with secret key. RFC8032 5.1.6 */
	function sign(msg, secretKey, options = {}) {
		validateObject(options, {}, {}, "options");
		msg = copyBytes$1(abytes$1(msg, void 0, "message"));
		if (prehash) msg = prehash(msg);
		const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
		const r = hashDomainToScalar(options.context, prefix, msg);
		const R = BASE.multiply(r).toBytes();
		const k = hashDomainToScalar(options.context, R, pointBytes, msg);
		const s = Fn.create(r + k * scalar);
		if (!Fn.isValid(s)) throw new Error("sign failed: invalid s");
		return abytes$1(concatBytes(R, Fn.toBytes(s)), lengths.signature, "result");
	}
	const verifyOpts = { zip215: opts.zip215 };
	/**
	* Verifies EdDSA signature against message and public key. RFC 8032 §§5.1.7 and 5.2.7.
	* A cofactored verification equation is checked.
	*/
	function verify(sig, msg, publicKey, options = verifyOpts) {
		validateObject(options);
		const { context } = options;
		const zip215 = options.zip215 === void 0 ? !!verifyOpts.zip215 : options.zip215;
		const len = lengths.signature;
		sig = abytes$1(sig, len, "signature");
		msg = abytes$1(msg, void 0, "message");
		publicKey = abytes$1(publicKey, lengths.publicKey, "publicKey");
		if (zip215 !== void 0) abool$1(zip215, "zip215");
		if (prehash) msg = prehash(msg);
		const mid = len / 2;
		const r = sig.subarray(0, mid);
		const s = bytesToNumberLE(sig.subarray(mid, len));
		let A, R, SB;
		try {
			A = Point.fromBytes(publicKey, zip215);
			R = Point.fromBytes(r, zip215);
			SB = BASE.multiplyUnsafe(s);
		} catch (error) {
			return false;
		}
		if (!zip215 && A.isSmallOrder()) return false;
		const k = hashDomainToScalar(context, r, publicKey, msg);
		return R.add(A.multiplyUnsafe(k)).subtract(SB).clearCofactor().is0();
	}
	const _size = Fp.BYTES;
	const lengths = {
		secretKey: _size,
		publicKey: _size,
		signature: 2 * _size,
		seed: _size
	};
	function randomSecretKey(seed) {
		seed = seed === void 0 ? randomBytes(lengths.seed) : seed;
		return abytes$1(seed, lengths.seed, "seed");
	}
	function isValidSecretKey(key) {
		return isBytes$1(key) && key.length === lengths.secretKey;
	}
	function isValidPublicKey(key, zip215) {
		try {
			return !!Point.fromBytes(key, zip215 === void 0 ? verifyOpts.zip215 : zip215);
		} catch (error) {
			return false;
		}
	}
	const utils = {
		getExtendedPublicKey,
		randomSecretKey,
		isValidSecretKey,
		isValidPublicKey,
		/** Converts an Edwards public key to a companion Montgomery public key. */
		toMontgomery(publicKey) {
			if (toMontgomery === void 0) throw new Error("Montgomery conversion is not supported for this curve");
			return toMontgomery(Point.fromBytes(publicKey));
		},
		toMontgomerySecret(secretKey) {
			if (toMontgomerySecret === void 0) throw new Error("Montgomery conversion is not supported for this curve");
			return toMontgomerySecret(secretKey);
		}
	};
	Object.freeze(lengths);
	Object.freeze(utils);
	return Object.freeze({
		keygen: createKeygen(randomSecretKey, getPublicKey),
		getPublicKey,
		sign,
		verify,
		utils,
		Point,
		lengths
	});
}
//#endregion
//#region @noble/curves/abstract/montgomery.js
/**
* Montgomery curve methods. It's not really whole montgomery curve,
* just bunch of very specific methods for X25519 / X448 from
* [RFC 7748](https://www.rfc-editor.org/rfc/rfc7748)
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$1 = /* @__PURE__ */ BigInt(0);
const _1n$1 = /* @__PURE__ */ BigInt(1);
const _2n$1 = /* @__PURE__ */ BigInt(2);
/**
* Selector for cswap(): `P` to keep, `P + 1` to swap, chosen by the low bit of `swap`.
* Higher bits are ignored, and `swap` is passed in whole rather than as a {0n, 1n} bit on
* purpose: `P + (swap & _1n)` would short-circuit the addition whenever the bit is clear, which
* is the very leak this construction avoids, one round-trip further down. Subtracting `swap`
* with its low bit cleared keeps every operand full-width instead.
* @param P - Field modulus.
* @param swap - Value whose low bit selects; ignored above that bit.
* @returns `P` when the low bit is clear, `P + 1` when it is set.
*/
function cmask(P, swap) {
	return P + swap - (swap >> _1n$1 << _1n$1);
}
/**
* Swap two field elements when `mask` is `P + 1`, keep them when it is `P`:
*
*   d    = 6P + x_3 - x_2
*   x_2' = d * mask + x_2   (mod P)      x_3' = (x_2 + x_3) - x_2'
*
* The extra `6P * mask` vanishes modulo P, so `mask === P` leaves x_2 and `mask === P + 1`
* leaves x_3. Without the offset, the reduction dividend changes sign with input order and crosses
* BigInt limb boundaries; those classes measured differently on the tested Node/V8 build. For
* canonical inputs, the deliberately left-associative `offset + x_3 - x_2` is between 5P and 7P,
* keeping the dividend positive and in one word-count band for both RFC fields and masks. Six is
* the smallest coefficient `c` for which the shared offset `cP` has that property.
*
* This reduced the tested sign/size timing ratios, but JavaScript BigInt has no constant-time
* contract and the contents of the multiply and remainder still vary. Valid ladder states can
* contain genuine zero coordinates; this construction does not mask those value-shape effects.
* Computing `x_3'` independently as `((6P + x_2 - x_3) * mask + x_3) % P` is more symmetric.
* On the tested Node/V8 build, it reduced the timing difference between keeping `(0, v)` and
* swapping `(v, 0)`—both return `(0, v)`—from about 10%/13% for X25519/X448 to about 3%.
* Successful calls cannot reach that zero-in-the-first-output case. For the case they can reach,
* swapping `(0, v)` and keeping `(v, 0)` both return `(v, 0)`; the difference instead grew from
* about 0.7%/1.1% to 2.7%/2.8%. The extra multiply/remainder also made public
* `getSharedSecret()` about 16% slower. The retained one-remainder form measured about 2.5%
* slower than the prior helper for public X25519 `getSharedSecret()` in the same environment.
* x_3' falls out of the sum, which a swap leaves invariant: no second multiply or reduction is
* needed. Bind `6P` once per field so production and the timing regression exercise the same
* configured helper without paying for the multiplication in every ladder round.
*
* The returned function is called twice per ladder round, so it validates nothing. Both elements
* MUST already be reduced mod P; unreduced input silently corrupts the kept-side output.
* @param P - Field modulus.
* @returns A field-bound swap function taking mask, x_2, and x_3.
*/
function cswap(P) {
	const offset = BigInt(6) * P;
	return (mask, x_2, x_3) => {
		const sum = x_2 + x_3;
		const a = ((offset + x_3 - x_2) * mask + x_2) % P;
		return {
			x_2: a,
			x_3: sum - a
		};
	};
}
function validateOpts(curve) {
	validateObject(curve, {
		P: "bigint",
		type: "string",
		adjustScalarBytes: "function",
		powPminus2: "function"
	}, {
		randomBytes: "function",
		scalarMultBase: "function"
	});
	return Object.freeze({ ...curve });
}
/**
* @param curveDef - Montgomery curve definition.
* @returns ECDH helper namespace.
* @throws If the curve definition or derived shared point is invalid. {@link Error}
* @example
* Build an X25519 helper from curve parameters, then derive one public key.
*
* ```ts
* import { montgomery } from '@noble/curves/abstract/montgomery.js';
* const P = 2n ** 255n - 19n;
* const mod = (num: bigint) => {
*   const out = num % P;
*   return out >= 0n ? out : out + P;
* };
* const pow = (num: bigint, power: bigint) => {
*   let res = 1n;
*   for (; power > 0n; power >>= 1n) {
*     if (power & 1n) res = mod(res * num);
*     num = mod(num * num);
*   }
*   return res;
* };
* const x25519 = montgomery({
*   P,
*   type: 'x25519',
*   adjustScalarBytes(bytes: Uint8Array) {
*     bytes[0] &= 248;
*     bytes[31] &= 127;
*     bytes[31] |= 64;
*     return bytes;
*   },
*   powPminus2(x) {
*     return pow(x, P - 2n);
*   },
* });
* const publicKey = x25519.getPublicKey(new Uint8Array(32).fill(1));
* ```
*/
function montgomery(curveDef) {
	const CURVE = validateOpts(curveDef);
	const { P, type, adjustScalarBytes, powPminus2, randomBytes: rand } = CURVE;
	const mulBaseHook = CURVE.scalarMultBase;
	const is25519 = type === "x25519";
	if (!is25519 && type !== "x448") throw new Error("invalid type");
	const randomBytes_ = rand === void 0 ? randomBytes$1 : rand;
	const montgomeryBits = is25519 ? 255 : 448;
	const swap = cswap(P);
	const fieldLen = is25519 ? 32 : 56;
	const Gu = is25519 ? BigInt(9) : BigInt(5);
	const a24 = is25519 ? BigInt(121665) : BigInt(39081);
	const minScalar = is25519 ? _2n$1 ** BigInt(254) : _2n$1 ** BigInt(447);
	const maxScalar = minScalar + (is25519 ? BigInt(8) * (_2n$1 ** BigInt(251) - _1n$1) : BigInt(4) * (_2n$1 ** BigInt(445) - _1n$1)) + _1n$1;
	const modP = (n) => mod(n, P);
	const GuBytes = encodeU(Gu);
	function encodeU(u) {
		return numberToBytesLE(modP(u), fieldLen);
	}
	function decodeU(u) {
		const _u = copyBytes$1(abytes$1(u, fieldLen, "uCoordinate"));
		if (is25519) _u[31] &= 127;
		return modP(bytesToNumberLE(_u));
	}
	function decodeScalar(scalar) {
		return bytesToNumberLE(adjustScalarBytes(copyBytes$1(abytes$1(scalar, fieldLen, "scalar"))));
	}
	/**
	* u coordinates whose order divides the cofactor, on the curve and on its quadratic twist -
	* the ladder sends every one of them to zero. Same blocklist libsodium and post-CVE-2017-0379
	* Libgcrypt carry. decodeU() reduces mod P first, so the non-canonical encodings P and P + 1
	* collapse onto 0 and 1, and `type` admits no curve beyond these two, so both lists are total.
	*
	* Complete by construction: x-only doubling sends u to (u^2 - 1)^2 / 4u(u^2 + a*u + 1). Order 4
	* therefore needs (u^2 - 1)^2 === 0, i.e. u = +-1; order 2 needs u(u^2 + a*u + 1) === 0, and
	* a^2 - 4 is a non-residue on both curves, leaving u = 0. curve448 stops there (cofactor 4);
	* curve25519 (cofactor 8) adds the two order-8 roots below. Cross-checked by clearing the
	* cofactor with those same doublings over 200k random u: no sixth value exists.
	*/
	const lowOrderU = new Set(is25519 ? [
		_0n$1,
		_1n$1,
		P - _1n$1,
		BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
		BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")
	] : [
		_0n$1,
		_1n$1,
		P - _1n$1
	]);
	function scalarMult(scalar, u) {
		const pointU = decodeU(u);
		if (lowOrderU.has(pointU)) throw new Error("invalid private or public key received");
		const pu = montgomeryLadder(pointU, decodeScalar(scalar));
		if (pu === _0n$1) throw new Error("invalid private or public key received");
		return encodeU(pu);
	}
	function scalarMultBase(scalar) {
		if (mulBaseHook === void 0) return scalarMult(scalar, GuBytes);
		const k = decodeScalar(scalar);
		aInRange("scalar", k, minScalar, maxScalar);
		const pu = modP(mulBaseHook(k));
		if (pu === _0n$1) throw new Error("invalid private or public key received");
		return encodeU(pu);
	}
	const getPublicKey = scalarMultBase;
	const getSharedSecret = scalarMult;
	/**
	* Montgomery x-only multiplication ladder for the selected X25519/X448 curve.
	* @param pointU - decoded Montgomery u coordinate for the selected curve
	* @param scalar - decoded clamped scalar by which the point is multiplied
	* @returns resulting Montgomery u coordinate for the selected curve
	*/
	function montgomeryLadder(u, scalar) {
		aInRange("u", u, _0n$1, P);
		aInRange("scalar", scalar, minScalar, maxScalar);
		const k = scalar;
		const x_1 = u;
		let x_2 = _1n$1;
		let z_2 = _0n$1;
		let x_3 = u;
		let z_3 = _1n$1;
		const kx = k ^ k >> _1n$1;
		for (let t = BigInt(montgomeryBits - 1); t >= _0n$1; t--) {
			const mask = cmask(P, kx >> t);
			({x_2, x_3} = swap(mask, x_2, x_3));
			({x_2: z_2, x_3: z_3} = swap(mask, z_2, z_3));
			const A = x_2 + z_2;
			const AA = modP(A * A);
			const B = x_2 - z_2;
			const BB = modP(B * B);
			const E = AA - BB;
			const C = x_3 + z_3;
			const D = x_3 - z_3;
			const DA = modP(D * A);
			const CB = modP(C * B);
			const dacb = DA + CB;
			const da_cb = DA - CB;
			x_3 = modP(dacb * dacb);
			z_3 = modP(x_1 * modP(da_cb * da_cb));
			x_2 = modP(AA * BB);
			z_2 = modP(E * (AA + modP(a24 * E)));
		}
		const mask = cmask(P, k);
		({x_2, x_3} = swap(mask, x_2, x_3));
		({x_2: z_2, x_3: z_3} = swap(mask, z_2, z_3));
		const z2 = powPminus2(z_2);
		return modP(x_2 * z2);
	}
	const lengths = {
		secretKey: fieldLen,
		publicKey: fieldLen,
		seed: fieldLen
	};
	const randomSecretKey = (seed) => {
		seed = seed === void 0 ? randomBytes_(fieldLen) : seed;
		abytes$1(seed, lengths.seed, "seed");
		return seed;
	};
	const utils = { randomSecretKey };
	Object.freeze(lengths);
	Object.freeze(utils);
	return Object.freeze({
		keygen: createKeygen(randomSecretKey, getPublicKey),
		getSharedSecret,
		getPublicKey,
		scalarMult,
		scalarMultBase,
		utils,
		GuBytes: GuBytes.slice(),
		lengths
	});
}
//#endregion
//#region @noble/curves/ed25519.js
/**
* ed25519 Twisted Edwards curve with following addons:
* - X25519 ECDH
* - Ristretto cofactor elimination
* - Elligator hash-to-group / point indistinguishability
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n = /* @__PURE__ */ BigInt(0), _1n = /* @__PURE__ */ BigInt(1), _2n = /* @__PURE__ */ BigInt(2), _3n = /* @__PURE__ */ BigInt(3);
const _5n = /* @__PURE__ */ BigInt(5), _8n = /* @__PURE__ */ BigInt(8);
const ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
const ed25519_CURVE = /* @__PURE__ */ (() => ({
	p: ed25519_CURVE_p,
	n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
	h: _8n,
	a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
	d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
	Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
	Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
	const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
	const P = ed25519_CURVE_p;
	const b2 = x * x % P * x % P;
	const b5 = pow2(pow2(b2, _2n, P) * b2 % P, _1n, P) * x % P;
	const b10 = pow2(b5, _5n, P) * b5 % P;
	const b20 = pow2(b10, _10n, P) * b10 % P;
	const b40 = pow2(b20, _20n, P) * b20 % P;
	const b80 = pow2(b40, _40n, P) * b40 % P;
	return {
		pow_p_5_8: pow2(pow2(pow2(pow2(b80, _80n, P) * b80 % P, _80n, P) * b80 % P, _10n, P) * b10 % P, _2n, P) * x % P,
		b2
	};
}
function adjustScalarBytes(bytes) {
	bytes[0] &= 248;
	bytes[31] &= 127;
	bytes[31] |= 64;
	return bytes;
}
const ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
	const P = ed25519_CURVE_p;
	const v3 = mod(v * v * v, P);
	const pow = ed25519_pow_2_252_3(u * mod(v3 * v3 * v, P)).pow_p_5_8;
	let x = mod(u * v3 * pow, P);
	const vx2 = mod(v * x * x, P);
	const root1 = x;
	const root2 = mod(x * ED25519_SQRT_M1, P);
	const useRoot1 = vx2 === u;
	const useRoot2 = vx2 === mod(-u, P);
	const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
	if (useRoot1) x = root1;
	if (useRoot2 || noRoot) x = root2;
	if (isNegativeLE(x, P)) x = mod(-x, P);
	return {
		isValid: useRoot1 || useRoot2,
		value: x
	};
}
const ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio });
const Fp = /* @__PURE__ */ (() => ed25519_Point.Fp)();
function toMontgomery(point) {
	const { y } = point;
	return Fp.toBytes(Fp.div(_1n + y, _1n - y));
}
function toMontgomerySecret(secretKey) {
	const size = ed25519_Point.Fp.BYTES;
	abytes$2(secretKey, size);
	return adjustScalarBytes(sha512(secretKey.subarray(0, size))).subarray(0, size);
}
function ed(opts) {
	return eddsa(ed25519_Point, sha512, Object.assign({
		adjustScalarBytes,
		toMontgomery,
		toMontgomerySecret,
		zip215: true
	}, opts));
}
/**
* ed25519 curve with EdDSA signatures.
* Seeded `keygen(seed)` / `utils.randomSecretKey(seed)` reuse the provided
* 32-byte seed buffer instead of copying it.
* @example
* Generate one Ed25519 keypair, sign a message, and verify it.
*
* ```js
* import { ed25519 } from '@noble/curves/ed25519.js';
* const { secretKey, publicKey } = ed25519.keygen();
* // const publicKey = ed25519.getPublicKey(secretKey);
* const msg = new TextEncoder().encode('hello noble');
* const sig = ed25519.sign(msg, secretKey);
* const isValid = ed25519.verify(sig, msg, publicKey); // ZIP215
* // RFC8032 / FIPS 186-5
* const isValid2 = ed25519.verify(sig, msg, publicKey, { zip215: false });
* ```
*/
const ed25519 = /* @__PURE__ */ ed({});
/**
* ECDH using curve25519 aka x25519.
* `getSharedSecret()` rejects low-order peer inputs by default, and seeded
* `keygen(seed)` reuses the provided 32-byte seed buffer instead of copying it.
* @example
* Derive one shared secret between two X25519 peers.
*
* ```js
* import { x25519 } from '@noble/curves/ed25519.js';
* const alice = x25519.keygen();
* const bob = x25519.keygen();
* const alicePublic = x25519.getPublicKey(alice.secretKey);
* const shared = x25519.getSharedSecret(alice.secretKey, bob.publicKey);
* ```
*/
const x25519 = /* @__PURE__ */ (() => {
	const P = ed25519_CURVE_p;
	const powPminus2 = (x) => {
		const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
		return mod(pow2(pow_p_5_8, _3n, P) * b2, P);
	};
	return montgomery({
		P,
		type: "x25519",
		powPminus2,
		adjustScalarBytes,
		scalarMultBase: (k) => {
			const kn = mod(k, ed25519_Point.Fn.ORDER);
			if (kn === _0n) return _0n;
			const p = ed25519_Point.BASE.multiply(kn);
			return mod((p.Z + p.Y) * powPminus2(mod(p.Z - p.Y, P)), P);
		}
	});
})();
//#endregion
//#region protocol/dist/keys.js
const MAILBOX_ID_RE = /^[A-Za-z0-9_-]{22}$/;
function generateX25519(seed) {
	const secretKey = seed ?? randomBytes(32);
	return {
		secretKey,
		publicKey: x25519.getPublicKey(secretKey)
	};
}
function generateEd25519(seed) {
	const secretKey = seed ?? randomBytes(32);
	return {
		secretKey,
		publicKey: ed25519.getPublicKey(secretKey)
	};
}
function mailboxIdFromSignKey(ed25519Pub) {
	if (ed25519Pub.length !== 32) throw new Error("Ed25519 public key must be 32 bytes.");
	return toBase64Url(sha256(concat(utf8Encode("sg-mailbox-v1"), ed25519Pub)).subarray(0, 16));
}
function generateIdentity() {
	const dh = generateX25519();
	const sign = generateEd25519();
	return {
		dh,
		sign,
		mailboxId: mailboxIdFromSignKey(sign.publicKey)
	};
}
function exportIdentity(id) {
	return {
		v: 1,
		dhSecret: toBase64Url(id.dh.secretKey),
		signSecret: toBase64Url(id.sign.secretKey)
	};
}
function importIdentity(stored) {
	if (!stored || stored.v !== 1) throw new Error("Unknown identity format.");
	const dh = generateX25519(fromBase64Url(stored.dhSecret));
	const sign = generateEd25519(fromBase64Url(stored.signSecret));
	if (dh.secretKey.length !== 32 || sign.secretKey.length !== 32) throw new Error("Bad identity keys.");
	return {
		dh,
		sign,
		mailboxId: mailboxIdFromSignKey(sign.publicKey)
	};
}
/** Short stable id for a public key (lookups, logs). 8 bytes of SHA-256, base64url. */
function keyId(publicKey) {
	return toBase64Url(sha256(concat(utf8Encode("sg-keyid-v1"), publicKey)).subarray(0, 8));
}
function sign(message, secretKey) {
	return ed25519.sign(message, secretKey);
}
function verify(signature, message, publicKey) {
	try {
		return ed25519.verify(signature, message, publicKey);
	} catch {
		return false;
	}
}
/** X25519 with low-order point rejection (noble throws on an all-zero result). */
function dh(secretKey, publicKey) {
	return x25519.getSharedSecret(secretKey, publicKey);
}
//#endregion
//#region @noble/ciphers/utils.js
/*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
/**
* Checks if something is Uint8Array. Be careful: nodejs Buffer will return true.
* @param a - Value to inspect.
* @returns `true` when the value is a Uint8Array view, including Node's `Buffer`.
* @example
* Guards a value before treating it as raw key material.
*
* ```ts
* isBytes(new Uint8Array());
* ```
*/
function isBytes(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
const atitle = (title) => title ? `"${title}" ` : "";
/**
* Asserts something is boolean.
* @param value - Value to validate.
* @returns The validated boolean.
* @throws On wrong argument types. {@link TypeError}
* @example
* Validates a boolean option before branching on it.
*
* ```ts
* abool(true);
* ```
*/
function abool(value, title = "") {
	if (typeof value !== "boolean") throw new TypeError(atitle(title) + "expected boolean, got type=" + typeof value);
	return value;
}
/**
* Asserts something is a non-negative safe integer.
* @param n - Value to validate.
* @returns The validated number.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validates a non-negative length or counter.
*
* ```ts
* anumber(1);
* ```
*/
function anumber(n, title = "") {
	if (typeof n !== "number") throw new TypeError(atitle(title) + "expected number, got " + typeof n);
	if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
	return n;
}
/**
* Asserts something is Uint8Array.
* @param value - Value to validate.
* @param length - Expected byte length.
* @param title - Optional label used in error messages.
* @returns The validated byte array.
* On Node, `Buffer` is accepted too because it is a Uint8Array view.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument lengths. {@link RangeError}
* @example
* Validates a fixed-length nonce or key buffer.
*
* ```ts
* abytes(new Uint8Array([1, 2]), 2);
* ```
*/
function abytes(value, length, title = "") {
	if (isBytes(value) && (length === void 0 || value.length === length)) return value;
	if (length !== void 0) anumber(length, "length");
	const bytes = isBytes(value);
	const ofLen = length !== void 0 ? ` of length ${length}` : "";
	const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
	const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
	if (!bytes) throw new TypeError(message);
	throw new RangeError(message);
}
const aobject = (value, label) => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(label === "object" ? "expected valid options object" : `"${label}" expected object, got type=${typeof value}`);
};
/**
* Asserts a hash- or MAC-like instance has not been destroyed or finished.
* @param instance - Stateful instance to validate.
* @param checkFinished - Whether to reject finished instances.
* When `false`, only `destroyed` is checked.
* @throws If the hash instance has already been destroyed or finalized. {@link Error}
* @example
* Guards against calling `update()` or `digest()` on a finished hash.
*
* ```ts
* aexists({ destroyed: false, finished: false });
* ```
*/
function aexists(instance, checkFinished = true) {
	if (instance.destroyed) throw new Error("hash was destroyed");
	if (checkFinished && instance.finished) throw new Error("digest() was already called");
}
/**
* Asserts output is a sufficiently-sized byte array.
* @param out - Output buffer to validate.
* @param instance - Hash-like instance providing `outputLen`.
* This is the relaxed `digestInto()`-style contract: output must be at least `outputLen`,
* unlike one-shot cipher helpers elsewhere in the repo that often require exact lengths.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong output buffer lengths. {@link RangeError}
* @example
* Verifies that a caller-provided output buffer is large enough.
*
* ```ts
* aoutput(new Uint8Array(16), { outputLen: 16 });
* ```
*/
function aoutput(out, instance) {
	abytes(out, void 0, "output");
	const min = instance.outputLen;
	if (!(out.length >= min)) throw new RangeError("\"output\" expected length >= " + min);
}
/**
* Casts a typed-array view to Uint32Array.
* @param arr - Typed-array view to reinterpret.
* @returns Uint32Array view over the same bytes. Callers are expected to provide a
* 4-byte-aligned offset; trailing `1..3` bytes are silently dropped.
* @example
* Views a byte buffer as 32-bit words for block processing.
*
* ```ts
* u32(new Uint8Array(4));
* ```
*/
function u32(arr) {
	return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
/**
* Zeroizes typed arrays in place.
* Warning: JS provides no guarantees.
* @param arrays - Arrays to wipe.
* @example
* Wipes a temporary key buffer after use.
*
* ```ts
* const bytes = new Uint8Array([1]);
* clean(bytes);
* ```
*/
function clean(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
/**
* Creates a DataView for byte-level manipulation.
* @param arr - Typed-array view to wrap.
* @returns DataView over the same bytes.
* @example
* Creates an endian-aware view for length encoding.
*
* ```ts
* createView(new Uint8Array(4));
* ```
*/
function createView(arr) {
	return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/**
* Whether the current platform is little-endian.
* Most are; some IBM systems are not.
*/
const isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
/**
* Reverses byte order of one 32-bit word.
* @param word - Unsigned 32-bit word to swap.
* @returns The same word with bytes reversed.
* @example
* Swaps a big-endian word into little-endian byte order.
*
* ```ts
* byteSwap(0x11223344);
* ```
*/
function byteSwap(word) {
	return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
/**
* Byte-swaps every word of a Uint32Array in place.
* @param arr - Uint32Array whose words should be swapped.
* @returns The same array after in-place byte swapping.
* @example
* Swaps every 32-bit word in a word-view buffer.
*
* ```ts
* byteSwap32(new Uint32Array([0x11223344]));
* ```
*/
function byteSwap32(arr) {
	for (let i = 0; i < arr.length; i++) arr[i] = byteSwap(arr[i]);
	return arr;
}
/**
* Normalizes a Uint32Array view to the little-endian representation expected by cipher cores.
* @param u - Word view to normalize in place.
* @returns Little-endian normalized word view.
* @example
* Normalizes a word-view buffer before block processing.
*
* ```ts
* swap32IfBE(new Uint32Array([0x11223344]));
* ```
*/
const swap32IfBE = isLE ? (u) => u : byteSwap32;
/**
* Checks if two U8A use same underlying buffer and overlaps.
* This is invalid and can corrupt data.
* @param a - First byte view.
* @param b - Second byte view.
* @returns `true` when the views overlap in memory.
* @example
* Detects whether two slices alias the same backing buffer.
*
* ```ts
* overlapBytes(new Uint8Array(4), new Uint8Array(4));
* ```
*/
function overlapBytes(a, b) {
	if (!a.byteLength || !b.byteLength) return false;
	return a.buffer === b.buffer && a.byteOffset < b.byteOffset + b.byteLength && b.byteOffset < a.byteOffset + a.byteLength;
}
/**
* If input and output overlap and input starts before output, we will overwrite end of input before
* we start processing it, so this is not supported by forward-processing ciphers.
* @param input - Input bytes.
* @param output - Output bytes.
* @throws If the output view would overwrite unread input bytes. {@link Error}
* @example
* Rejects an in-place layout that would overwrite unread input bytes.
*
* ```ts
* const buffer = new Uint8Array(8);
* complexOverlapBytes(buffer.subarray(0, 4), buffer.subarray(2, 6));
* ```
*/
function complexOverlapBytes(input, output) {
	if (overlapBytes(input, output) && input.byteOffset < output.byteOffset) throw new Error("complex overlap of input and output is not supported");
}
/**
* Merges user options into defaults.
* @param defaults - Default option values.
* @param opts - User-provided overrides.
* @returns Combined options object.
* `defaults` is a library-owned mutable object; user-provided `opts` only need to be
* object-shaped, since "plain object" checks reject valid proxy/cross-realm containers.
* The merge mutates `defaults` in place and returns the same object, so direct callers
* should pass a fresh defaults object unless they intentionally want shared state updated.
* @throws If options are missing or not an object. {@link Error}
* @example
* Applies user overrides to the default cipher options.
*
* ```ts
* checkOpts({ rounds: 20 }, { rounds: 8 });
* ```
*/
function checkOpts$1(defaults, opts) {
	aobject(defaults, "defaults");
	aobject(opts, "opts");
	return Object.assign(defaults, opts);
}
/**
* Compares two byte arrays in kinda constant time once lengths already match.
* @param a - First byte array.
* @param b - Second byte array.
* @returns `true` when the arrays contain the same bytes. Different lengths still return early.
* @example
* Compares an expected authentication tag with the received one.
*
* ```ts
* equalBytes(new Uint8Array([1]), new Uint8Array([1]));
* ```
*/
function equalBytes$1(a, b) {
	a = abytes(a);
	b = abytes(b);
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
/**
* Wraps a keyed MAC constructor into a one-shot helper with `.create()`.
* @param keyLen - Valid probe-key length used to read static metadata once.
* The probe key is only used for `outputLen` / `blockLen`, so callers with several valid key sizes
* can pass any representative size as long as those values stay fixed.
* @param macCons - Keyed MAC constructor or factory.
* @param fromMsg - Optional adapter that derives extra constructor args from the one-shot message.
* @returns Callable MAC helper with `.create()`.
*/
function wrapMacConstructor(keyLen, macCons, fromMsg) {
	const mac = macCons;
	const getArgs = fromMsg || (() => []);
	const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
	const tmp = mac(new Uint8Array(keyLen), ...getArgs(/* @__PURE__ */ new Uint8Array(0)));
	macC.outputLen = tmp.outputLen;
	macC.blockLen = tmp.blockLen;
	macC.create = (key, ...args) => mac(key, ...args);
	return macC;
}
/**
* Wraps a cipher: validates args, ensures encrypt() can only be called once.
* Used internally by the exported cipher constructors.
* Output-buffer support is inferred from the wrapped `encrypt` / `decrypt`
* arity (`fn.length === 2`), so wrapped output-capable methods must use a normal
* second parameter, not a default/rest parameter. AAD support is explicit in
* `params.withAAD`; optional AAD starts after the nonce slot when one is present.
* @__NO_SIDE_EFFECTS__
* @param params - Static cipher metadata. See {@link CipherParams}.
* @param constructor - Cipher constructor.
* @returns Wrapped constructor with validation.
*/
const wrapCipher = (params, constructor) => {
	function wrappedCipher(key, ...args) {
		abytes(key, void 0, "key");
		if (params.nonceLength !== void 0) {
			const nonce = args[0];
			abytes(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
		}
		const tagl = params.tagLength;
		const aadStart = params.nonceLength !== void 0 ? 1 : 0;
		if (!params.withAAD) {
			for (let i = aadStart; i < args.length; i++) if (isBytes(args[i])) throw new Error("AAD not supported");
		}
		if (params.withAAD && args[aadStart] !== void 0) abytes(args[aadStart], void 0, "AAD");
		const cipher = constructor(key, ...args);
		const checkOutput = (fnLength, output) => {
			if (output !== void 0) {
				if (fnLength !== 2) throw new Error("cipher output not supported");
				abytes(output, void 0, "output");
			}
		};
		let called = false;
		return {
			encrypt(data, output) {
				if (called) throw new Error("cannot encrypt() twice with same key + nonce");
				called = true;
				abytes(data, void 0, "data");
				checkOutput(cipher.encrypt.length, output);
				return cipher.encrypt(data, output);
			},
			decrypt(data, output) {
				abytes(data, void 0, "data");
				if (tagl && data.length < tagl) throw new Error("\"ciphertext\" expected length >= tagLength=" + tagl);
				checkOutput(cipher.decrypt.length, output);
				return cipher.decrypt(data, output);
			}
		};
	}
	Object.assign(wrappedCipher, params);
	return wrappedCipher;
};
/**
* By default, returns u8a of length.
* When out is available, it checks it for validity and uses it.
* @param expectedLength - Required output length.
* @param out - Optional destination buffer.
* @param onlyAligned - Whether `out` must be 4-byte aligned.
* @returns Output buffer ready for writing.
* @throws On wrong argument types. {@link TypeError}
* @throws If the provided output buffer has the wrong size. {@link RangeError}
* @throws If the provided output buffer has the wrong alignment. {@link Error}
* @example
* Reuses a caller-provided output buffer when lengths match.
*
* ```ts
* getOutput(16, new Uint8Array(16));
* ```
*/
function getOutput(expectedLength, out, onlyAligned = true) {
	if (out === void 0) return new Uint8Array(expectedLength);
	abytes(out, expectedLength, "output");
	if (onlyAligned && !isAligned32(out)) throw new Error("invalid output, must be aligned");
	return out;
}
/**
* Encodes data and AAD lengths into a 16-byte buffer.
* @param dataLength - Data length. Units are caller-defined: GCM passes bit
* lengths, ChaCha20-Poly1305 passes byte lengths — the helper writes the raw values.
* @param aadLength - AAD length, same unit convention as `dataLength`.
* The serialized block is still `aadLength || dataLength`, matching GCM/Poly1305
* conventions even though the helper parameter order is `(dataLength, aadLength)`.
* @param isLE - Whether to encode lengths as little-endian.
* @returns 16-byte length block.
* @throws On wrong argument types passed to the endian validator. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Builds the length block appended by GCM and Poly1305.
*
* ```ts
* u64Lengths(16, 8, true);
* ```
*/
function u64Lengths(dataLength, aadLength, isLE) {
	anumber(dataLength);
	anumber(aadLength);
	abool(isLE);
	const num = /* @__PURE__ */ new Uint8Array(16);
	const view = createView(num);
	view.setBigUint64(0, BigInt(aadLength), isLE);
	view.setBigUint64(8, BigInt(dataLength), isLE);
	return num;
}
/**
* Checks whether a byte array is aligned to a 4-byte offset.
* @param bytes - Byte array to inspect.
* @returns `true` when the view is 4-byte aligned.
* @example
* Checks whether a buffer can be safely viewed as Uint32Array.
*
* ```ts
* isAligned32(new Uint8Array(4));
* ```
*/
function isAligned32(bytes) {
	return bytes.byteOffset % 4 === 0;
}
/**
* Copies bytes into a new Uint8Array.
* @param bytes - Bytes to copy.
* @returns Copied byte array.
* @throws On wrong argument types. {@link TypeError}
* @example
* Copies input into an aligned Uint8Array before block processing.
*
* ```ts
* copyBytes(new Uint8Array([1, 2]));
* ```
*/
function copyBytes(bytes) {
	return Uint8Array.from(abytes(bytes));
}
//#endregion
//#region @noble/ciphers/_arx.js
/**
* Basic utils for ARX (add-rotate-xor) salsa and chacha ciphers.

RFC8439 requires multi-step cipher stream, where
authKey starts with counter: 0, actual msg with counter: 1.

For this, we need a way to re-use nonce / counter:

const counter = new Uint8Array(4);
chacha(..., counter, ...); // counter is now 1
chacha(..., counter, ...); // counter is now 2

This is complicated:

- 32-bit counters are enough, no need for 64-bit: max ArrayBuffer size in JS is 4GB
- Original papers don't allow mutating counters
- Counter overflow is undefined [^1]
- Idea A: allow providing (nonce | counter) instead of just nonce, re-use it
- Caveat: Cannot be re-used through all cases:
- * chacha has (counter | nonce)
- * xchacha has (nonce16 | counter | nonce16)
- Idea B: separate nonce / counter and provide separate API for counter re-use
- Caveat: there are different counter sizes depending on an algorithm.
- salsa & chacha also differ in structures of key & sigma:
salsa20:      s[0] | k(4) | s[1] | nonce(2) | cnt(2) | s[2] | k(4) | s[3]
chacha:       s(4) | k(8) | cnt(1) | nonce(3)
chacha20orig: s(4) | k(8) | cnt(2) | nonce(2)
- Idea C: helper method such as `setSalsaState(key, nonce, sigma, data)`
- Caveat: we can't re-use counter array

xchacha uses the subkey and remaining 8 byte nonce with ChaCha20 as normal
(prefixed by 4 NUL bytes, since RFC8439 specifies a 12-byte nonce).
Counter overflow is undefined; see {@link https://mailarchive.ietf.org/arch/msg/cfrg/gsOnTJzcbgG6OqD8Sc0GO5aR_tU/ | the CFRG thread}.
Current noble policy is strict non-wrap for the shared 32-bit counter path:
exported ARX ciphers reject initial `0xffffffff` and stop before any implicit
wrap back to zero.
See {@link https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha#appendix-A.2 | the XChaCha appendix} for the extended-nonce construction.

* @module
*/
const encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
const sigma16_32 = /* @__PURE__ */ (() => swap32IfBE(u32(encodeStr("expand 16-byte k"))))();
const sigma32_32 = /* @__PURE__ */ (() => swap32IfBE(u32(encodeStr("expand 32-byte k"))))();
/**
* Rotates a 32-bit word left.
* @param a - Input word.
* @param b - Rotation count in bits.
* @returns Rotated 32-bit word.
* @example
* Moves the top byte of `0x12345678` into the low byte position.
* ```ts
* rotl(0x12345678, 8);
* ```
*/
function rotl(a, b) {
	return a << b | a >>> 32 - b;
}
const BLOCK_LEN = 64;
const BLOCK_LEN32 = 16;
const MAX_COUNTER = /* @__PURE__ */ (() => 2 ** 32 - 1)();
const U32_EMPTY = /* @__PURE__ */ Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
	const len = data.length;
	const block = new Uint8Array(BLOCK_LEN);
	const b32 = u32(block);
	const isAligned = isLE && isAligned32(data) && isAligned32(output);
	const d32 = isAligned ? u32(data) : U32_EMPTY;
	const o32 = isAligned ? u32(output) : U32_EMPTY;
	if (!isLE) {
		for (let pos = 0; pos < len; counter++) {
			core(sigma, key, nonce, b32, counter, rounds);
			swap32IfBE(b32);
			if (counter >= MAX_COUNTER) throw new Error("arx: counter overflow");
			const take = Math.min(BLOCK_LEN, len - pos);
			for (let j = 0, posj; j < take; j++) {
				posj = pos + j;
				output[posj] = data[posj] ^ block[j];
			}
			pos += take;
		}
		return;
	}
	for (let pos = 0; pos < len; counter++) {
		core(sigma, key, nonce, b32, counter, rounds);
		if (counter >= MAX_COUNTER) throw new Error("arx: counter overflow");
		const take = Math.min(BLOCK_LEN, len - pos);
		if (isAligned && take === BLOCK_LEN) {
			const pos32 = pos / 4;
			if (pos % 4 !== 0) throw new Error("arx: invalid block position");
			for (let j = 0, posj; j < BLOCK_LEN32; j++) {
				posj = pos32 + j;
				o32[posj] = d32[posj] ^ b32[j];
			}
			pos += BLOCK_LEN;
			continue;
		}
		for (let j = 0, posj; j < take; j++) {
			posj = pos + j;
			output[posj] = data[posj] ^ block[j];
		}
		pos += take;
	}
}
/**
* Creates an ARX stream cipher from a 32-bit core permutation.
* Used internally to build the exported Salsa and ChaCha stream ciphers.
* @param core - Core function that fills one keystream block.
* @param opts - Cipher layout and nonce-extension options. See {@link CipherOpts}.
* @returns Stream cipher function over byte arrays.
* @throws If the core callback, key size, counter, or output sizing is invalid. {@link Error}
*/
function createCipher(core, opts) {
	const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts$1({
		allowShortKeys: false,
		counterLength: 8,
		counterRight: false,
		rounds: 20
	}, opts);
	if (typeof core !== "function") throw new Error("core must be a function");
	anumber(counterLength);
	anumber(rounds);
	abool(counterRight);
	abool(allowShortKeys);
	return (key, nonce, data, output, counter = 0) => {
		abytes(key, void 0, "key");
		abytes(nonce, void 0, "nonce");
		abytes(data, void 0, "data");
		const len = data.length;
		const hasOutput = output !== void 0;
		output = getOutput(len, output, false);
		if (hasOutput) complexOverlapBytes(data, output);
		anumber(counter);
		if (counter < 0 || counter >= MAX_COUNTER) throw new Error("arx: counter overflow");
		const toClean = [];
		let l = key.length;
		let k;
		let sigma;
		if (l === 32) {
			toClean.push(k = copyBytes(key));
			sigma = sigma32_32;
		} else if (l === 16 && allowShortKeys) {
			k = /* @__PURE__ */ new Uint8Array(32);
			k.set(key);
			k.set(key, 16);
			sigma = sigma16_32;
			toClean.push(k);
		} else {
			abytes(key, 32, "arx key");
			throw new Error("invalid key size");
		}
		if (!isLE || !isAligned32(nonce)) toClean.push(nonce = copyBytes(nonce));
		let k32 = u32(k);
		if (extendNonceFn) {
			if (nonce.length !== 24) throw new Error("arx: extended nonce must be 24 bytes");
			const n16 = nonce.subarray(0, 16);
			if (isLE) extendNonceFn(sigma, k32, u32(n16), k32);
			else {
				const sigmaRaw = swap32IfBE(Uint32Array.from(sigma));
				extendNonceFn(sigmaRaw, k32, u32(n16), k32);
				clean(sigmaRaw);
				swap32IfBE(k32);
			}
			nonce = nonce.subarray(16);
		} else if (!isLE) swap32IfBE(k32);
		const nonceNcLen = 16 - counterLength;
		if (nonceNcLen !== nonce.length) throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
		if (nonceNcLen !== 12) {
			const nc = /* @__PURE__ */ new Uint8Array(12);
			nc.set(nonce, counterRight ? 0 : 12 - nonce.length);
			nonce = nc;
			toClean.push(nonce);
		}
		const n32 = swap32IfBE(u32(nonce));
		try {
			runCipher(core, sigma, k32, n32, data, output, counter, rounds);
			return output;
		} finally {
			clean(...toClean);
		}
	};
}
//#endregion
//#region @noble/ciphers/_poly1305.js
/**
* Poly1305 ({@link https://cr.yp.to/mac/poly1305-20050329.pdf | PDF},
* {@link https://en.wikipedia.org/wiki/Poly1305 | wiki})
* is a fast and parallel secret-key message-authentication code suitable for
* a wide variety of applications. It was standardized in
* {@link https://www.rfc-editor.org/rfc/rfc8439 | RFC 8439} and is now used in TLS 1.3.
*
* Polynomial MACs are not perfect for every situation:
* they lack Random Key Robustness: the MAC can be forged, and can't be used in PAKE schemes.
* See {@link https://keymaterial.net/2020/09/07/invisible-salamanders-in-aes-gcm-siv/ | the invisible salamanders attack writeup}.
* To combat invisible salamanders, `hash(key)` can be included in ciphertext,
* however, this would violate ciphertext indistinguishability:
* an attacker would know which key was used - so `HKDF(key, i)`
* could be used instead.
*
* Check out the {@link https://cr.yp.to/mac.html | original website}.
* Based on public-domain {@link https://github.com/floodyberry/poly1305-donna | poly1305-donna}.
* @module
*/
function u8to16(a, i) {
	return a[i++] & 255 | (a[i++] & 255) << 8;
}
/**
* Incremental Poly1305 MAC state.
* Prefer `poly1305()` for one-shot use.
* @param key - 32-byte Poly1305 one-time key.
* @example
* Feeds one chunk into an incremental Poly1305 state with a fresh one-time key.
*
* ```ts
* import { Poly1305 } from '@noble/ciphers/_poly1305.js';
* import { randomBytes } from '@noble/ciphers/utils.js';
* const key = randomBytes(32);
* const mac = new Poly1305(key);
* mac.update(new Uint8Array([1, 2, 3]));
* mac.digest();
* ```
*/
var Poly1305 = class {
	blockLen = 16;
	outputLen = 16;
	buffer = /* @__PURE__ */ new Uint8Array(16);
	r = /* @__PURE__ */ new Uint16Array(10);
	h = /* @__PURE__ */ new Uint16Array(10);
	pad = /* @__PURE__ */ new Uint16Array(8);
	pos = 0;
	finished = false;
	destroyed = false;
	constructor(key) {
		key = copyBytes(abytes(key, 32, "key"));
		const t0 = u8to16(key, 0);
		const t1 = u8to16(key, 2);
		const t2 = u8to16(key, 4);
		const t3 = u8to16(key, 6);
		const t4 = u8to16(key, 8);
		const t5 = u8to16(key, 10);
		const t6 = u8to16(key, 12);
		const t7 = u8to16(key, 14);
		this.r[0] = t0 & 8191;
		this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
		this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
		this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
		this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
		this.r[5] = t4 >>> 1 & 8190;
		this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
		this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
		this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
		this.r[9] = t7 >>> 5 & 127;
		for (let i = 0; i < 8; i++) this.pad[i] = u8to16(key, 16 + 2 * i);
	}
	process(data, offset, isLast = false) {
		const hibit = isLast ? 0 : 2048;
		const { h, r } = this;
		const r0 = r[0];
		const r1 = r[1];
		const r2 = r[2];
		const r3 = r[3];
		const r4 = r[4];
		const r5 = r[5];
		const r6 = r[6];
		const r7 = r[7];
		const r8 = r[8];
		const r9 = r[9];
		const t0 = u8to16(data, offset + 0);
		const t1 = u8to16(data, offset + 2);
		const t2 = u8to16(data, offset + 4);
		const t3 = u8to16(data, offset + 6);
		const t4 = u8to16(data, offset + 8);
		const t5 = u8to16(data, offset + 10);
		const t6 = u8to16(data, offset + 12);
		const t7 = u8to16(data, offset + 14);
		let h0 = h[0] + (t0 & 8191);
		let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
		let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
		let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
		let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
		let h5 = h[5] + (t4 >>> 1 & 8191);
		let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
		let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
		let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
		let h9 = h[9] + (t7 >>> 5 | hibit);
		let c = 0;
		let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
		c = d0 >>> 13;
		d0 &= 8191;
		d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
		c += d0 >>> 13;
		d0 &= 8191;
		let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
		c = d1 >>> 13;
		d1 &= 8191;
		d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
		c += d1 >>> 13;
		d1 &= 8191;
		let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
		c = d2 >>> 13;
		d2 &= 8191;
		d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
		c += d2 >>> 13;
		d2 &= 8191;
		let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
		c = d3 >>> 13;
		d3 &= 8191;
		d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
		c += d3 >>> 13;
		d3 &= 8191;
		let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
		c = d4 >>> 13;
		d4 &= 8191;
		d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
		c += d4 >>> 13;
		d4 &= 8191;
		let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
		c = d5 >>> 13;
		d5 &= 8191;
		d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
		c += d5 >>> 13;
		d5 &= 8191;
		let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
		c = d6 >>> 13;
		d6 &= 8191;
		d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
		c += d6 >>> 13;
		d6 &= 8191;
		let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
		c = d7 >>> 13;
		d7 &= 8191;
		d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
		c += d7 >>> 13;
		d7 &= 8191;
		let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
		c = d8 >>> 13;
		d8 &= 8191;
		d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
		c += d8 >>> 13;
		d8 &= 8191;
		let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
		c = d9 >>> 13;
		d9 &= 8191;
		d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
		c += d9 >>> 13;
		d9 &= 8191;
		c = (c << 2) + c | 0;
		c = c + d0 | 0;
		d0 = c & 8191;
		c = c >>> 13;
		d1 += c;
		h[0] = d0;
		h[1] = d1;
		h[2] = d2;
		h[3] = d3;
		h[4] = d4;
		h[5] = d5;
		h[6] = d6;
		h[7] = d7;
		h[8] = d8;
		h[9] = d9;
	}
	finalize() {
		const { h, pad } = this;
		const g = /* @__PURE__ */ new Uint16Array(10);
		let c = h[1] >>> 13;
		h[1] &= 8191;
		for (let i = 2; i < 10; i++) {
			h[i] += c;
			c = h[i] >>> 13;
			h[i] &= 8191;
		}
		h[0] += c * 5;
		c = h[0] >>> 13;
		h[0] &= 8191;
		h[1] += c;
		c = h[1] >>> 13;
		h[1] &= 8191;
		h[2] += c;
		g[0] = h[0] + 5;
		c = g[0] >>> 13;
		g[0] &= 8191;
		for (let i = 1; i < 10; i++) {
			g[i] = h[i] + c;
			c = g[i] >>> 13;
			g[i] &= 8191;
		}
		g[9] -= 8192;
		let mask = (c ^ 1) - 1;
		for (let i = 0; i < 10; i++) g[i] &= mask;
		mask = ~mask;
		for (let i = 0; i < 10; i++) h[i] = h[i] & mask | g[i];
		h[0] = (h[0] | h[1] << 13) & 65535;
		h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
		h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
		h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
		h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
		h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
		h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
		h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
		let f = h[0] + pad[0];
		h[0] = f & 65535;
		for (let i = 1; i < 8; i++) {
			f = (h[i] + pad[i] | 0) + (f >>> 16) | 0;
			h[i] = f & 65535;
		}
		clean(g);
	}
	update(data) {
		aexists(this);
		abytes(data);
		data = copyBytes(data);
		const { buffer, blockLen } = this;
		const len = data.length;
		for (let pos = 0; pos < len;) {
			const take = Math.min(blockLen - this.pos, len - pos);
			if (take === blockLen) {
				for (; blockLen <= len - pos; pos += blockLen) this.process(data, pos);
				continue;
			}
			buffer.set(data.subarray(pos, pos + take), this.pos);
			this.pos += take;
			pos += take;
			if (this.pos === blockLen) {
				this.process(buffer, 0, false);
				this.pos = 0;
			}
		}
		return this;
	}
	destroy() {
		this.destroyed = true;
		clean(this.h, this.r, this.buffer, this.pad);
	}
	digestInto(out) {
		aexists(this);
		aoutput(out, this);
		this.finished = true;
		const { buffer, h } = this;
		let { pos } = this;
		if (pos) {
			buffer[pos++] = 1;
			for (; pos < 16; pos++) buffer[pos] = 0;
			this.process(buffer, 0, true);
		}
		this.finalize();
		let opos = 0;
		for (let i = 0; i < 8; i++) {
			out[opos++] = h[i] >>> 0;
			out[opos++] = h[i] >>> 8;
		}
	}
	digest() {
		const { buffer, outputLen } = this;
		this.digestInto(buffer);
		const res = buffer.slice(0, outputLen);
		this.destroy();
		return res;
	}
};
/**
* Poly1305 MAC from RFC 8439.
* @param msg - Message bytes to authenticate.
* @param key - 32-byte Poly1305 one-time key.
* @returns 16-byte authentication tag.
* @example
* Authenticates one message with a one-shot Poly1305 call and a fresh key.
*
* ```ts
* import { poly1305 } from '@noble/ciphers/_poly1305.js';
* import { randomBytes } from '@noble/ciphers/utils.js';
* const key = randomBytes(32);
* poly1305(new Uint8Array(), key);
* ```
*/
const poly1305 = /* @__PURE__ */ wrapMacConstructor(32, (key) => new Poly1305(key));
//#endregion
//#region @noble/ciphers/chacha.js
/**
* ChaCha stream cipher, released
* in 2008. Developed after Salsa20, ChaCha aims to increase diffusion per round.
* It was standardized in
* {@link https://www.rfc-editor.org/rfc/rfc8439 | RFC 8439} and
* is now used in TLS 1.3.
*
* {@link https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha | XChaCha20}
* extended-nonce variant is also provided. Similar to XSalsa, it's safe to use with
* randomly-generated nonces.
*
* Check out
* {@link http://cr.yp.to/chacha/chacha-20080128.pdf | PDF},
* {@link https://en.wikipedia.org/wiki/Salsa20 | wiki}, and
* {@link https://cr.yp.to/chacha.html | website}.
*
* @module
*/
/**
* ChaCha core function. Uses an unrolled loop (chachaCore, hchacha) - 4x
* faster than a simple loop, but larger & harder to read. A simple-loop
* reference version lives in `test/misc/micro-ciphers.ts`;
* `test/arx.test.ts` keeps the two aligned.
* The specific implementation is selected in `createCipher` below.
*/
/** RFC 8439 §2.3 block core for `state = constants | key | counter | nonce`. */
function chachaCore(s, k, n, out, cnt, rounds = 20) {
	let y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
	let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
	for (let r = 0; r < rounds; r += 2) {
		x00 = x00 + x04 | 0;
		x12 = rotl(x12 ^ x00, 16);
		x08 = x08 + x12 | 0;
		x04 = rotl(x04 ^ x08, 12);
		x00 = x00 + x04 | 0;
		x12 = rotl(x12 ^ x00, 8);
		x08 = x08 + x12 | 0;
		x04 = rotl(x04 ^ x08, 7);
		x01 = x01 + x05 | 0;
		x13 = rotl(x13 ^ x01, 16);
		x09 = x09 + x13 | 0;
		x05 = rotl(x05 ^ x09, 12);
		x01 = x01 + x05 | 0;
		x13 = rotl(x13 ^ x01, 8);
		x09 = x09 + x13 | 0;
		x05 = rotl(x05 ^ x09, 7);
		x02 = x02 + x06 | 0;
		x14 = rotl(x14 ^ x02, 16);
		x10 = x10 + x14 | 0;
		x06 = rotl(x06 ^ x10, 12);
		x02 = x02 + x06 | 0;
		x14 = rotl(x14 ^ x02, 8);
		x10 = x10 + x14 | 0;
		x06 = rotl(x06 ^ x10, 7);
		x03 = x03 + x07 | 0;
		x15 = rotl(x15 ^ x03, 16);
		x11 = x11 + x15 | 0;
		x07 = rotl(x07 ^ x11, 12);
		x03 = x03 + x07 | 0;
		x15 = rotl(x15 ^ x03, 8);
		x11 = x11 + x15 | 0;
		x07 = rotl(x07 ^ x11, 7);
		x00 = x00 + x05 | 0;
		x15 = rotl(x15 ^ x00, 16);
		x10 = x10 + x15 | 0;
		x05 = rotl(x05 ^ x10, 12);
		x00 = x00 + x05 | 0;
		x15 = rotl(x15 ^ x00, 8);
		x10 = x10 + x15 | 0;
		x05 = rotl(x05 ^ x10, 7);
		x01 = x01 + x06 | 0;
		x12 = rotl(x12 ^ x01, 16);
		x11 = x11 + x12 | 0;
		x06 = rotl(x06 ^ x11, 12);
		x01 = x01 + x06 | 0;
		x12 = rotl(x12 ^ x01, 8);
		x11 = x11 + x12 | 0;
		x06 = rotl(x06 ^ x11, 7);
		x02 = x02 + x07 | 0;
		x13 = rotl(x13 ^ x02, 16);
		x08 = x08 + x13 | 0;
		x07 = rotl(x07 ^ x08, 12);
		x02 = x02 + x07 | 0;
		x13 = rotl(x13 ^ x02, 8);
		x08 = x08 + x13 | 0;
		x07 = rotl(x07 ^ x08, 7);
		x03 = x03 + x04 | 0;
		x14 = rotl(x14 ^ x03, 16);
		x09 = x09 + x14 | 0;
		x04 = rotl(x04 ^ x09, 12);
		x03 = x03 + x04 | 0;
		x14 = rotl(x14 ^ x03, 8);
		x09 = x09 + x14 | 0;
		x04 = rotl(x04 ^ x09, 7);
	}
	let oi = 0;
	out[oi++] = y00 + x00 | 0;
	out[oi++] = y01 + x01 | 0;
	out[oi++] = y02 + x02 | 0;
	out[oi++] = y03 + x03 | 0;
	out[oi++] = y04 + x04 | 0;
	out[oi++] = y05 + x05 | 0;
	out[oi++] = y06 + x06 | 0;
	out[oi++] = y07 + x07 | 0;
	out[oi++] = y08 + x08 | 0;
	out[oi++] = y09 + x09 | 0;
	out[oi++] = y10 + x10 | 0;
	out[oi++] = y11 + x11 | 0;
	out[oi++] = y12 + x12 | 0;
	out[oi++] = y13 + x13 | 0;
	out[oi++] = y14 + x14 | 0;
	out[oi++] = y15 + x15 | 0;
}
/**
* hchacha hashes key and nonce into key' and nonce' for xchacha20.
* Algorithmically identical to `hchacha_small` from `test/misc/micro-ciphers.ts`,
* but this exported path normalizes word order on big-endian hosts.
* Reuses `chachaCore` and subtracts its feed-forward, keeping the hot per-block
* path untouched.
* @param s - Sigma constants as 32-bit words.
* @param k - Key words.
* @param i - Nonce-prefix words.
* @param out - Output buffer for the derived subkey.
* @example
* Derives the XChaCha subkey from sigma, key, and nonce-prefix words.
*
* ```ts
* const sigma = new Uint32Array(4);
* const key = new Uint32Array(8);
* const nonce = new Uint32Array(4);
* const out = new Uint32Array(8);
* hchacha(sigma, key, nonce, out);
* ```
*/
function hchacha(s, k, i, out) {
	const s2 = isLE ? s : swap32IfBE(s.slice(0, 4));
	const k2 = isLE ? k : swap32IfBE(k.slice(0, 8));
	const i2 = isLE ? i : swap32IfBE(i.slice(0, 4));
	const t = /* @__PURE__ */ new Uint32Array(16);
	chachaCore(s2, k2, i2.subarray(1), t, i2[0]);
	let oi = 0;
	out[oi++] = t[0] - s2[0] | 0;
	out[oi++] = t[1] - s2[1] | 0;
	out[oi++] = t[2] - s2[2] | 0;
	out[oi++] = t[3] - s2[3] | 0;
	out[oi++] = t[12] - i2[0] | 0;
	out[oi++] = t[13] - i2[1] | 0;
	out[oi++] = t[14] - i2[2] | 0;
	out[oi++] = t[15] - i2[3] | 0;
	swap32IfBE(out);
	if (!isLE) clean(s2, k2, i2);
	clean(t);
}
/**
* ChaCha stream cipher. Conforms to RFC 8439 (IETF, TLS). 12-byte nonce, 4-byte counter.
* With smaller nonce, it's not safe to make it random (CSPRNG), due to collision chance.
* @param key - 32-byte key.
* @param nonce - 12-byte nonce.
* @param data - Input bytes to xor with the keystream.
* @param output - Optional destination buffer.
* @param counter - Initial block counter.
* @returns Encrypted or decrypted bytes.
* @example
* Encrypts bytes with the RFC 8439 ChaCha20 stream cipher and a fresh key/nonce.
*
* ```ts
* import { chacha20 } from '@noble/ciphers/chacha.js';
* import { randomBytes } from '@noble/ciphers/utils.js';
* const key = randomBytes(32);
* const nonce = randomBytes(12);
* chacha20(key, nonce, new Uint8Array(4));
* ```
*/
const chacha20 = /* @__PURE__ */ createCipher(chachaCore, {
	counterRight: false,
	counterLength: 4,
	allowShortKeys: false
});
/**
* XChaCha eXtended-nonce ChaCha. With 24-byte nonce, it's safe to make it random (CSPRNG).
* See {@link https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha | the IRTF draft}.
* The nonce/counter layout still reserves 8 counter bytes internally, but the shared public
* `counter` argument follows noble's strict non-wrapping 32-bit policy. See `src/_arx.ts`
* near `MAX_COUNTER` for the full counter-policy rationale.
* @param key - 32-byte key.
* @param nonce - 24-byte extended nonce.
* @param data - Input bytes to xor with the keystream.
* @param output - Optional destination buffer.
* @param counter - Initial block counter.
* @returns Encrypted or decrypted bytes.
* @example
* Encrypts bytes with XChaCha20 using a fresh key and random 24-byte nonce.
*
* ```ts
* import { xchacha20 } from '@noble/ciphers/chacha.js';
* import { randomBytes } from '@noble/ciphers/utils.js';
* const key = randomBytes(32);
* const nonce = randomBytes(24);
* xchacha20(key, nonce, new Uint8Array(4));
* ```
*/
const xchacha20 = /* @__PURE__ */ createCipher(chachaCore, {
	counterRight: false,
	counterLength: 8,
	extendNonceFn: hchacha,
	allowShortKeys: false
});
const ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
const updatePadded = (h, msg) => {
	h.update(msg);
	const leftover = msg.length % 16;
	if (leftover) h.update(ZEROS16.subarray(leftover));
};
const ZEROS32 = /* @__PURE__ */ new Uint8Array(32);
function computeTag(fn, key, nonce, ciphertext, AAD) {
	if (AAD !== void 0) abytes(AAD, void 0, "AAD");
	const authKey = fn(key, nonce, ZEROS32);
	const lengths = u64Lengths(ciphertext.length, AAD ? AAD.length : 0, true);
	const h = poly1305.create(authKey);
	if (AAD) updatePadded(h, AAD);
	updatePadded(h, ciphertext);
	h.update(lengths);
	const res = h.digest();
	clean(authKey, lengths);
	return res;
}
/**
* AEAD algorithm from RFC 8439.
* Salsa20 and chacha (RFC 8439) use poly1305 differently.
* We could have composed them, but it's hard because of authKey:
* In salsa20, authKey changes position in salsa stream.
* In chacha, authKey can't be computed inside computeTag, it modifies the counter.
*/
const _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
	const tagLength = 16;
	return {
		encrypt(plaintext, output) {
			const plength = plaintext.length;
			output = getOutput(plength + tagLength, output, false);
			output.set(plaintext);
			const oPlain = output.subarray(0, -16);
			xorStream(key, nonce, oPlain, oPlain, 1);
			const tag = computeTag(xorStream, key, nonce, oPlain, AAD);
			output.set(tag, plength);
			clean(tag);
			return output;
		},
		decrypt(ciphertext, output) {
			output = getOutput(ciphertext.length - tagLength, output, false);
			const data = ciphertext.subarray(0, -16);
			const passedTag = ciphertext.subarray(-16);
			const tag = computeTag(xorStream, key, nonce, data, AAD);
			if (!equalBytes$1(passedTag, tag)) {
				clean(tag);
				throw new Error("invalid tag");
			}
			output.set(ciphertext.subarray(0, -16));
			xorStream(key, nonce, output, output, 1);
			clean(tag);
			return output;
		}
	};
};
/**
* ChaCha20-Poly1305 from RFC 8439.
*
* Unsafe to use random nonces under the same key, due to collision chance.
* Prefer XChaCha instead.
* @param key - 32-byte key.
* @param nonce - 12-byte nonce.
* @param AAD - Additional authenticated data.
* @returns AEAD cipher instance.
* @example
* Encrypts and authenticates plaintext with a fresh key and nonce.
*
* ```ts
* import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
* import { randomBytes } from '@noble/ciphers/utils.js';
* const key = randomBytes(32);
* const nonce = randomBytes(12);
* const aad = new TextEncoder().encode('session metadata');
* const cipher = chacha20poly1305(key, nonce, aad);
* cipher.encrypt(new Uint8Array([1, 2, 3]));
* ```
*/
const chacha20poly1305 = /* @__PURE__ */ wrapCipher({
	blockSize: 64,
	nonceLength: 12,
	tagLength: 16,
	withAAD: true
}, /* @__PURE__ */ _poly1305_aead(chacha20));
/**
* XChaCha20-Poly1305 extended-nonce chacha.
*
* Can be safely used with random nonces (CSPRNG).
* See {@link https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha | the IRTF draft}.
* @param key - 32-byte key.
* @param nonce - 24-byte nonce.
* @param AAD - Additional authenticated data.
* @returns AEAD cipher instance.
* @example
* Encrypts and authenticates plaintext with a fresh key and random 24-byte nonce.
*
* ```ts
* import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
* import { randomBytes } from '@noble/ciphers/utils.js';
* const key = randomBytes(32);
* const nonce = randomBytes(24);
* const aad = new TextEncoder().encode('session metadata');
* const cipher = xchacha20poly1305(key, nonce, aad);
* cipher.encrypt(new Uint8Array([1, 2, 3]));
* ```
*/
const xchacha20poly1305 = /* @__PURE__ */ wrapCipher({
	blockSize: 64,
	nonceLength: 24,
	tagLength: 16,
	withAAD: true
}, /* @__PURE__ */ _poly1305_aead(xchacha20));
//#endregion
//#region @noble/hashes/hmac.js
/**
* HMAC: RFC2104 message authentication code.
* @module
*/
/**
* Internal class for HMAC.
* Accepts any byte key, although RFC 2104 §3 recommends keys at least
* `HashLen` bytes long.
*/
var _HMAC = class {
	oHash;
	iHash;
	blockLen;
	outputLen;
	canXOF = false;
	finished = false;
	destroyed = false;
	constructor(hash, key) {
		ahash(hash);
		abytes$2(key, void 0, "key");
		this.iHash = hash.create();
		if (typeof this.iHash.update !== "function") throw new Error("expected Hash instance");
		this.blockLen = this.iHash.blockLen;
		this.outputLen = this.iHash.outputLen;
		const blockLen = this.blockLen;
		const pad = new Uint8Array(blockLen);
		pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
		for (let i = 0; i < pad.length; i++) pad[i] ^= 54;
		this.iHash.update(pad);
		this.oHash = hash.create();
		for (let i = 0; i < pad.length; i++) pad[i] ^= 106;
		this.oHash.update(pad);
		clean$1(pad);
	}
	update(buf) {
		aexists$1(this);
		this.iHash.update(buf);
		return this;
	}
	digestInto(out) {
		aexists$1(this);
		aoutput$1(out, this);
		this.finished = true;
		const buf = out.subarray(0, this.outputLen);
		this.iHash.digestInto(buf);
		this.oHash.update(buf);
		this.oHash.digestInto(buf);
		this.destroy();
	}
	digest() {
		const out = new Uint8Array(this.oHash.outputLen);
		this.digestInto(out);
		return out;
	}
	_cloneInto(to) {
		to ||= Object.create(Object.getPrototypeOf(this), {});
		const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
		to = to;
		to.finished = finished;
		to.destroyed = destroyed;
		to.blockLen = blockLen;
		to.outputLen = outputLen;
		to.canXOF = canXOF;
		to.oHash = oHash._cloneInto(to.oHash);
		to.iHash = iHash._cloneInto(to.iHash);
		return to;
	}
	clone() {
		return this._cloneInto();
	}
	destroy() {
		this.destroyed = true;
		this.oHash.destroy();
		this.iHash.destroy();
	}
};
const hmac = /* @__PURE__ */ (() => {
	const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
	hmac_.create = (hash, key) => new _HMAC(hash, key);
	return hmac_;
})();
//#endregion
//#region protocol/dist/noise.js
const DHLEN = 32;
const HASHLEN = 32;
const MAX_NONCE = 2n ** 64n - 2n;
function protocolName(pattern) {
	return `Noise_${pattern}_25519_ChaChaPoly_SHA256`;
}
/** Noise nonce: 4 zero bytes then the 64-bit counter little endian. */
function noiseNonce(n) {
	if (n < 0n || n > MAX_NONCE) throw new Error("Nonce out of range.");
	const out = /* @__PURE__ */ new Uint8Array(12);
	let v = n;
	for (let i = 4; i < 12; i++) {
		out[i] = Number(v & 255n);
		v >>= 8n;
	}
	return out;
}
function aeadEncrypt(k, n, ad, plaintext) {
	return chacha20poly1305(k, noiseNonce(n), ad).encrypt(plaintext);
}
/** Throws on authentication failure. */
function aeadDecrypt(k, n, ad, ciphertext) {
	return chacha20poly1305(k, noiseNonce(n), ad).decrypt(ciphertext);
}
function hkdfNoise(ck, ikm, outputs) {
	const temp = hmac(sha256, ck, ikm);
	const o1 = hmac(sha256, temp, Uint8Array.of(1));
	const o2 = hmac(sha256, temp, concat(o1, Uint8Array.of(2)));
	if (outputs === 2) {
		wipe(temp);
		return [o1, o2];
	}
	const o3 = hmac(sha256, temp, concat(o2, Uint8Array.of(3)));
	wipe(temp);
	return [
		o1,
		o2,
		o3
	];
}
/** A Noise CipherState with an implicit counter (used during the handshake and for vectors). */
var CipherState = class {
	k = null;
	n = 0n;
	constructor(k) {
		if (k) this.k = k;
	}
	hasKey() {
		return this.k !== null;
	}
	encryptWithAd(ad, plaintext) {
		if (!this.k) return plaintext;
		const out = aeadEncrypt(this.k, this.n, ad, plaintext);
		this.n++;
		return out;
	}
	decryptWithAd(ad, ciphertext) {
		if (!this.k) return ciphertext;
		const out = aeadDecrypt(this.k, this.n, ad, ciphertext);
		this.n++;
		return out;
	}
};
var SymmetricState = class {
	ck;
	h;
	cs = new CipherState();
	constructor(name) {
		const nb = utf8Encode(name);
		if (nb.length <= HASHLEN) {
			this.h = new Uint8Array(HASHLEN);
			this.h.set(nb);
		} else this.h = sha256(nb);
		this.ck = this.h.slice();
	}
	mixKey(ikm) {
		const [ck, k] = hkdfNoise(this.ck, ikm, 2);
		wipe(this.ck);
		this.ck = ck;
		this.cs = new CipherState(k);
	}
	mixHash(data) {
		this.h = sha256(concat(this.h, data));
	}
	mixKeyAndHash(ikm) {
		const [ck, th, k] = hkdfNoise(this.ck, ikm, 3);
		wipe(this.ck);
		this.ck = ck;
		this.mixHash(th);
		this.cs = new CipherState(k);
	}
	encryptAndHash(pt) {
		const ct = this.cs.encryptWithAd(this.h, pt);
		this.mixHash(ct);
		return ct;
	}
	decryptAndHash(ct) {
		const pt = this.cs.decryptWithAd(this.h, ct);
		this.mixHash(ct);
		return pt;
	}
	split() {
		const [k1, k2] = hkdfNoise(this.ck, /* @__PURE__ */ new Uint8Array(0), 2);
		return [k1, k2];
	}
};
/**
* Two message handshake. Initiator: writeMessage1, readMessage2. Responder: readMessage1, writeMessage2.
* After the second message call result().
*/
var Handshake = class {
	opts;
	ss;
	e = null;
	re = null;
	rs;
	step = 0;
	done = false;
	constructor(opts) {
		this.opts = opts;
		if (opts.s.publicKey.length !== DHLEN) throw new Error("Bad static key.");
		if (opts.pattern !== "IK" && (!opts.psk || opts.psk.length !== 32)) throw new Error("PSK patterns need a 32-byte PSK.");
		if (opts.pattern === "IK" && opts.psk) throw new Error("IK takes no PSK.");
		if (opts.initiator && (!opts.rs || opts.rs.length !== DHLEN)) throw new Error("Initiator needs the remote static key.");
		this.rs = opts.rs ?? null;
		this.ss = new SymmetricState(protocolName(opts.pattern));
		this.ss.mixHash(opts.prologue);
		this.ss.mixHash(opts.initiator ? opts.rs : opts.s.publicKey);
	}
	get psk() {
		return this.opts.pattern !== "IK";
	}
	writeMessage1(payload) {
		if (!this.opts.initiator || this.step !== 0) throw new Error("Handshake out of order.");
		const e = this.opts.e ?? generateX25519();
		this.e = e;
		this.ss.mixHash(e.publicKey);
		if (this.psk) this.ss.mixKey(e.publicKey);
		this.ss.mixKey(dh(e.secretKey, this.rs));
		const encS = this.ss.encryptAndHash(this.opts.s.publicKey);
		this.ss.mixKey(dh(this.opts.s.secretKey, this.rs));
		if (this.opts.pattern === "IKpsk1") this.ss.mixKeyAndHash(this.opts.psk);
		const encP = this.ss.encryptAndHash(payload);
		this.step = 1;
		return concat(e.publicKey, encS, encP);
	}
	readMessage1(message) {
		if (this.opts.initiator || this.step !== 0) throw new Error("Handshake out of order.");
		if (message.length < 96) throw new Error("Handshake message too short.");
		const re = message.subarray(0, DHLEN).slice();
		this.re = re;
		this.ss.mixHash(re);
		if (this.psk) this.ss.mixKey(re);
		this.ss.mixKey(dh(this.opts.s.secretKey, re));
		const rs = this.ss.decryptAndHash(message.subarray(DHLEN, 80));
		this.rs = rs;
		this.ss.mixKey(dh(this.opts.s.secretKey, rs));
		if (this.opts.pattern === "IKpsk1") this.ss.mixKeyAndHash(this.opts.psk);
		const payload = this.ss.decryptAndHash(message.subarray(80));
		this.step = 1;
		return payload;
	}
	writeMessage2(payload) {
		if (this.opts.initiator || this.step !== 1) throw new Error("Handshake out of order.");
		const e = this.opts.e ?? generateX25519();
		this.e = e;
		this.ss.mixHash(e.publicKey);
		if (this.psk) this.ss.mixKey(e.publicKey);
		this.ss.mixKey(dh(e.secretKey, this.re));
		this.ss.mixKey(dh(e.secretKey, this.rs));
		if (this.opts.pattern === "IKpsk2") this.ss.mixKeyAndHash(this.opts.psk);
		const encP = this.ss.encryptAndHash(payload);
		this.step = 2;
		this.done = true;
		return concat(e.publicKey, encP);
	}
	readMessage2(message) {
		if (!this.opts.initiator || this.step !== 1) throw new Error("Handshake out of order.");
		if (message.length < 48) throw new Error("Handshake message too short.");
		const re = message.subarray(0, DHLEN).slice();
		this.re = re;
		this.ss.mixHash(re);
		if (this.psk) this.ss.mixKey(re);
		this.ss.mixKey(dh(this.e.secretKey, re));
		this.ss.mixKey(dh(this.opts.s.secretKey, re));
		if (this.opts.pattern === "IKpsk2") this.ss.mixKeyAndHash(this.opts.psk);
		const payload = this.ss.decryptAndHash(message.subarray(DHLEN));
		this.step = 2;
		this.done = true;
		return payload;
	}
	/** Remote static key, available to the responder after readMessage1. */
	remoteStatic() {
		return this.rs;
	}
	result() {
		if (!this.done) throw new Error("Handshake not finished.");
		const [k1, k2] = this.ss.split();
		if (this.e && !this.opts.e) wipe(this.e.secretKey);
		return {
			initiatorToResponder: k1,
			responderToInitiator: k2,
			handshakeHash: this.ss.h.slice(),
			remoteStatic: this.rs
		};
	}
};
//#endregion
//#region protocol/dist/envelope.js
const ENVELOPE_VERSION = 1;
const EnvelopeKind = {
	PairInit: 1,
	PairResp: 2,
	SessionInit: 3,
	SessionResp: 4,
	Session: 16,
	Sealed: 32
};
const KINDS = new Set(Object.values(EnvelopeKind));
/** Plaintext is padded to the smallest bucket that fits (hides exact sizes from the relay). */
const PAD_BUCKETS = [
	256,
	1024,
	4096,
	16384,
	32768
];
/** Largest message body after padding overhead (4-byte length prefix). */
const MAX_PLAINTEXT = 32764;
/** Largest envelope a client may send (fits a 64 KiB relay frame after base64url). */
const MAX_ENVELOPE_BYTES = 40 * 1024;
function pad(data) {
	const needed = data.length + 4;
	const bucket = PAD_BUCKETS.find((b) => b >= needed);
	if (bucket === void 0) throw new Error(`Message too large (${data.length} bytes, max ${MAX_PLAINTEXT}).`);
	const out = new Uint8Array(bucket);
	out.set(u32be(data.length), 0);
	out.set(data, 4);
	return out;
}
function unpad(padded) {
	if (padded.length < 4 || !PAD_BUCKETS.includes(padded.length)) throw new Error("Bad padding.");
	const len = readU32be(padded, 0);
	if (len > padded.length - 4) throw new Error("Bad padding.");
	for (let i = 4 + len; i < padded.length; i++) if (padded[i] !== 0) throw new Error("Bad padding.");
	return padded.subarray(4, 4 + len);
}
function header(kind, ...fields) {
	return concat(Uint8Array.of(1, kind), ...fields);
}
/** Reads version and kind without decrypting. Throws on unknown version or kind. */
function peekEnvelope(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 2) throw new Error("Envelope too short.");
	if (bytes.length > 40960) throw new Error("Envelope too large.");
	const version = bytes[0];
	const kind = bytes[1];
	if (version !== 1) throw new Error(`Unsupported envelope version ${version}.`);
	if (!KINDS.has(kind)) throw new Error(`Unknown envelope kind ${kind}.`);
	return {
		version,
		kind
	};
}
const DEFAULT_CONFIG = {
	lang: void 0,
	message: void 0,
	abortEarly: void 0,
	abortPipeEarly: void 0
};
/**
* Returns the global configuration.
*
* @param config The config to merge.
*
* @returns The configuration.
*/
/* @__NO_SIDE_EFFECTS__ */
function getGlobalConfig(config$1) {
	if (!config$1 && true) return DEFAULT_CONFIG;
	return {
		lang: config$1?.lang ?? void 0,
		message: config$1?.message,
		abortEarly: config$1?.abortEarly ?? void 0,
		abortPipeEarly: config$1?.abortPipeEarly ?? void 0
	};
}
/**
* Stringifies an unknown input to a literal or type string.
*
* @param input The unknown input.
*
* @returns A literal or type string.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _stringify(input) {
	const type = typeof input;
	if (type === "string") return `"${input}"`;
	if (type === "number" || type === "bigint" || type === "boolean") return `${input}`;
	if (type === "object" || type === "function") return (input && Object.getPrototypeOf(input)?.constructor?.name) ?? "null";
	return type;
}
/**
* Adds an issue to the dataset.
*
* @param context The issue context.
* @param label The issue label.
* @param dataset The input dataset.
* @param config The configuration.
* @param other The optional props.
*
* @internal
*/
function _addIssue(context, label, dataset, config$1, other) {
	const input = other && "input" in other ? other.input : dataset.value;
	const expected = other?.expected ?? context.expects ?? null;
	const received = other?.received ?? /* @__PURE__ */ _stringify(input);
	const issue = {
		kind: context.kind,
		type: context.type,
		input,
		expected,
		received,
		message: `Invalid ${label}: ${expected ? `Expected ${expected} but r` : "R"}eceived ${received}`,
		requirement: context.requirement,
		path: other?.path,
		issues: other?.issues,
		lang: config$1.lang,
		abortEarly: config$1.abortEarly,
		abortPipeEarly: config$1.abortPipeEarly
	};
	const isSchema = context.kind === "schema";
	const message$1 = other?.message ?? context.message ?? (context.reference, issue.lang, void 0) ?? (isSchema ? (issue.lang, void 0) : null) ?? config$1.message ?? (issue.lang, void 0);
	if (message$1 !== void 0) issue.message = typeof message$1 === "function" ? message$1(issue) : message$1;
	if (isSchema) dataset.typed = false;
	if (dataset.issues) dataset.issues.push(issue);
	else dataset.issues = [issue];
}
/**
* Compares two values using the SameValueZero algorithm, which treats `NaN`
* as equal to itself unlike `===`.
*
* @param value1 The first value.
* @param value2 The second value.
*
* @returns Whether the values are equal.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _isSameValueZero(value1, value2) {
	return value1 === value2 || Number.isNaN(value1) && Number.isNaN(value2);
}
/**
* Disallows inherited object properties and prevents object prototype
* pollution by disallowing certain keys.
*
* @param object The object to check.
* @param key The key to check.
*
* @returns Whether the key is allowed.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _isValidObjectKey(object$1, key) {
	return Object.prototype.hasOwnProperty.call(object$1, key) && key !== "__proto__" && key !== "prototype" && key !== "constructor";
}
/**
* Joins multiple `expects` values with the given separator.
*
* @param values The `expects` values.
* @param separator The separator.
*
* @returns The joined `expects` property.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _joinExpects(values$1, separator) {
	const list = [...new Set(values$1)];
	if (list.length > 1) return `(${list.join(` ${separator} `)})`;
	return list[0] ?? "never";
}
/**
* Eagerly creates and attaches the Standard Schema properties of a schema.
*
* Hint: The contextual `this` type includes the standard properties that are
* attached before the schema is returned.
*
* @param schema The schema to attach standard properties to.
*
* @returns The schema with standard properties attached.
*
* @internal
*/
function _standardSchema(schema) {
	schema["~standard"] = {
		version: 1,
		vendor: "valibot",
		validate: (value$1) => schema["~run"]({ value: value$1 }, /* @__PURE__ */ getGlobalConfig())
	};
	return schema;
}
/* @__NO_SIDE_EFFECTS__ */
function getDotPath(issue) {
	if (issue.path) {
		let key = "";
		for (const item of issue.path) if (typeof item.key === "string" || typeof item.key === "number") if (key) key += `.${item.key}`;
		else key += item.key;
		else return null;
		return key;
	}
	return null;
}
/**
* A Valibot error with useful information.
*/
var ValiError = class extends Error {
	/**
	* Creates a Valibot error with useful information.
	*
	* @param issues The error issues.
	*/
	constructor(issues) {
		super(issues[0].message);
		this.name = "ValiError";
		this.issues = issues;
	}
};
/* @__NO_SIDE_EFFECTS__ */
function check(requirement, message$1) {
	return {
		kind: "validation",
		type: "check",
		reference: check,
		async: false,
		expects: null,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !this.requirement(dataset.value)) _addIssue(this, "input", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function integer(message$1) {
	return {
		kind: "validation",
		type: "integer",
		reference: integer,
		async: false,
		expects: null,
		requirement: Number.isInteger,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !this.requirement(dataset.value)) _addIssue(this, "integer", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function maxLength(requirement, message$1) {
	return {
		kind: "validation",
		type: "max_length",
		reference: maxLength,
		async: false,
		expects: `<=${requirement}`,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && dataset.value.length > this.requirement) _addIssue(this, "length", dataset, config$1, { received: `${dataset.value.length}` });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function maxValue(requirement, message$1) {
	return {
		kind: "validation",
		type: "max_value",
		reference: maxValue,
		async: false,
		expects: `<=${requirement instanceof Date ? requirement.toJSON() : /* @__PURE__ */ _stringify(requirement)}`,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !(dataset.value <= this.requirement)) _addIssue(this, "value", dataset, config$1, { received: dataset.value instanceof Date ? dataset.value.toJSON() : /* @__PURE__ */ _stringify(dataset.value) });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function minLength(requirement, message$1) {
	return {
		kind: "validation",
		type: "min_length",
		reference: minLength,
		async: false,
		expects: `>=${requirement}`,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && dataset.value.length < this.requirement) _addIssue(this, "length", dataset, config$1, { received: `${dataset.value.length}` });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function minValue(requirement, message$1) {
	return {
		kind: "validation",
		type: "min_value",
		reference: minValue,
		async: false,
		expects: `>=${requirement instanceof Date ? requirement.toJSON() : /* @__PURE__ */ _stringify(requirement)}`,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !(dataset.value >= this.requirement)) _addIssue(this, "value", dataset, config$1, { received: dataset.value instanceof Date ? dataset.value.toJSON() : /* @__PURE__ */ _stringify(dataset.value) });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function regex(requirement, message$1) {
	return {
		kind: "validation",
		type: "regex",
		reference: regex,
		async: false,
		expects: `${requirement}`,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !this.requirement.test(dataset.value)) _addIssue(this, "format", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function safeInteger(message$1) {
	return {
		kind: "validation",
		type: "safe_integer",
		reference: safeInteger,
		async: false,
		expects: null,
		requirement: Number.isSafeInteger,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !this.requirement(dataset.value)) _addIssue(this, "safe integer", dataset, config$1);
			return dataset;
		}
	};
}
const ABORT_EARLY_CONFIG = { abortEarly: true };
/**
* Returns the fallback value of the schema.
*
* @param schema The schema to get it from.
* @param dataset The output dataset if available.
* @param config The config if available.
*
* @returns The fallback value.
*/
/* @__NO_SIDE_EFFECTS__ */
function getFallback(schema, dataset, config$1) {
	return typeof schema.fallback === "function" ? schema.fallback(dataset, config$1) : schema.fallback;
}
/**
* Returns the default value of the schema.
*
* @param schema The schema to get it from.
* @param dataset The input dataset if available.
* @param config The config if available.
*
* @returns The default value.
*/
/* @__NO_SIDE_EFFECTS__ */
function getDefault(schema, dataset, config$1) {
	return typeof schema.default === "function" ? schema.default(dataset, config$1) : schema.default;
}
/* @__NO_SIDE_EFFECTS__ */
function array(item, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "array",
		reference: array,
		expects: "Array",
		async: false,
		item,
		message: message$1,
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (Array.isArray(input)) {
				dataset.typed = true;
				dataset.value = [];
				for (let key = 0; key < input.length; key++) {
					const value$1 = input[key];
					const itemDataset = this.item["~run"]({ value: value$1 }, config$1);
					if (itemDataset.issues) {
						const pathItem = {
							type: "array",
							origin: "value",
							input,
							key,
							value: value$1
						};
						for (const issue of itemDataset.issues) {
							if (issue.path) issue.path.unshift(pathItem);
							else issue.path = [pathItem];
							dataset.issues?.push(issue);
						}
						if (!dataset.issues) dataset.issues = itemDataset.issues;
						if (config$1.abortEarly) {
							dataset.typed = false;
							break;
						}
					}
					if (!itemDataset.typed) dataset.typed = false;
					dataset.value.push(itemDataset.value);
				}
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function boolean(message$1) {
	return _standardSchema({
		kind: "schema",
		type: "boolean",
		reference: boolean,
		expects: "boolean",
		async: false,
		message: message$1,
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "boolean") dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function literal(literal_, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "literal",
		reference: literal,
		expects: /* @__PURE__ */ _stringify(literal_),
		async: false,
		literal: literal_,
		message: message$1,
		"~run"(dataset, config$1) {
			if (/* @__PURE__ */ _isSameValueZero(dataset.value, this.literal)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function nullable(wrapped, default_) {
	return _standardSchema({
		kind: "schema",
		type: "nullable",
		reference: nullable,
		expects: `(${wrapped.expects} | null)`,
		async: false,
		wrapped,
		default: default_,
		"~run"(dataset, config$1) {
			if (dataset.value === null) {
				if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
				if (dataset.value === null) {
					dataset.typed = true;
					return dataset;
				}
			}
			return this.wrapped["~run"](dataset, config$1);
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function number(message$1) {
	return _standardSchema({
		kind: "schema",
		type: "number",
		reference: number,
		expects: "number",
		async: false,
		message: message$1,
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "number" && !isNaN(dataset.value)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function object(entries$1, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "object",
		reference: object,
		expects: "Object",
		async: false,
		entries: entries$1,
		message: message$1,
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (input && typeof input === "object") {
				dataset.typed = true;
				dataset.value = {};
				for (const key in this.entries) {
					const valueSchema = this.entries[key];
					if (key in input || (valueSchema.type === "exact_optional" || valueSchema.type === "optional" || valueSchema.type === "nullish") && valueSchema.default !== void 0) {
						const value$1 = key in input ? input[key] : /* @__PURE__ */ getDefault(valueSchema);
						const valueDataset = valueSchema["~run"]({ value: value$1 }, config$1);
						if (valueDataset.issues) {
							const pathItem = {
								type: "object",
								origin: "value",
								input,
								key,
								value: value$1
							};
							for (const issue of valueDataset.issues) {
								if (issue.path) issue.path.unshift(pathItem);
								else issue.path = [pathItem];
								dataset.issues?.push(issue);
							}
							if (!dataset.issues) dataset.issues = valueDataset.issues;
							if (config$1.abortEarly) {
								dataset.typed = false;
								break;
							}
						}
						if (!valueDataset.typed) dataset.typed = false;
						dataset.value[key] = valueDataset.value;
					} else if (valueSchema.fallback !== void 0) dataset.value[key] = /* @__PURE__ */ getFallback(valueSchema);
					else if (valueSchema.type !== "exact_optional" && valueSchema.type !== "optional" && valueSchema.type !== "nullish") {
						_addIssue(this, "key", dataset, config$1, {
							input: void 0,
							expected: `"${key}"`,
							path: [{
								type: "object",
								origin: "key",
								input,
								key,
								value: input[key]
							}]
						});
						if (config$1.abortEarly) break;
					}
				}
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function optional(wrapped, default_) {
	return _standardSchema({
		kind: "schema",
		type: "optional",
		reference: optional,
		expects: `(${wrapped.expects} | undefined)`,
		async: false,
		wrapped,
		default: default_,
		"~run"(dataset, config$1) {
			if (dataset.value === void 0) {
				if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
				if (dataset.value === void 0) {
					dataset.typed = true;
					return dataset;
				}
			}
			return this.wrapped["~run"](dataset, config$1);
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function picklist(options, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "picklist",
		reference: picklist,
		expects: /* @__PURE__ */ _joinExpects(options.map(_stringify), "|"),
		async: false,
		options,
		message: message$1,
		"~run"(dataset, config$1) {
			if (this.options.includes(dataset.value)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function record(key, value$1, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "record",
		reference: record,
		expects: "Object",
		async: false,
		key,
		value: value$1,
		message: message$1,
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (input && typeof input === "object") {
				dataset.typed = true;
				dataset.value = {};
				for (const entryKey in input) if (/* @__PURE__ */ _isValidObjectKey(input, entryKey)) {
					const entryValue = input[entryKey];
					const keyDataset = this.key["~run"]({ value: entryKey }, config$1);
					if (keyDataset.issues) {
						const pathItem = {
							type: "object",
							origin: "key",
							input,
							key: entryKey,
							value: entryValue
						};
						for (const issue of keyDataset.issues) {
							issue.path = [pathItem];
							dataset.issues?.push(issue);
						}
						if (!dataset.issues) dataset.issues = keyDataset.issues;
						if (config$1.abortEarly) {
							dataset.typed = false;
							break;
						}
					}
					const valueDataset = this.value["~run"]({ value: entryValue }, config$1);
					if (valueDataset.issues) {
						const pathItem = {
							type: "object",
							origin: "value",
							input,
							key: entryKey,
							value: entryValue
						};
						for (const issue of valueDataset.issues) {
							if (issue.path) issue.path.unshift(pathItem);
							else issue.path = [pathItem];
							dataset.issues?.push(issue);
						}
						if (!dataset.issues) dataset.issues = valueDataset.issues;
						if (config$1.abortEarly) {
							dataset.typed = false;
							break;
						}
					}
					if (!keyDataset.typed || !valueDataset.typed) dataset.typed = false;
					if (keyDataset.typed) dataset.value[keyDataset.value] = valueDataset.value;
				}
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function string(message$1) {
	return _standardSchema({
		kind: "schema",
		type: "string",
		reference: string,
		expects: "string",
		async: false,
		message: message$1,
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "string") dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/**
* Creates a unknown schema.
*
* @returns A unknown schema.
*/
/* @__NO_SIDE_EFFECTS__ */
function unknown() {
	return _standardSchema({
		kind: "schema",
		type: "unknown",
		reference: unknown,
		expects: "unknown",
		async: false,
		"~run"(dataset) {
			dataset.typed = true;
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function variant(key, options, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "variant",
		reference: variant,
		expects: "Object",
		async: false,
		key,
		options,
		message: message$1,
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (input && typeof input === "object") {
				let outputDataset;
				let maxDiscriminatorPriority = 0;
				let invalidDiscriminatorKey = this.key;
				let expectedDiscriminators = [];
				const parseOptions = (variant$1, allKeys) => {
					for (const schema of variant$1.options) {
						if (schema.type === "variant") parseOptions(schema, new Set(allKeys).add(schema.key));
						else {
							let keysAreValid = true;
							let currentPriority = 0;
							for (const currentKey of allKeys) {
								const discriminatorSchema = schema.entries[currentKey];
								if (currentKey in input ? discriminatorSchema["~run"]({
									typed: false,
									value: input[currentKey]
								}, ABORT_EARLY_CONFIG).issues : discriminatorSchema.type !== "exact_optional" && discriminatorSchema.type !== "optional" && discriminatorSchema.type !== "nullish") {
									keysAreValid = false;
									if (invalidDiscriminatorKey !== currentKey && (maxDiscriminatorPriority < currentPriority || maxDiscriminatorPriority === currentPriority && currentKey in input && !(invalidDiscriminatorKey in input))) {
										maxDiscriminatorPriority = currentPriority;
										invalidDiscriminatorKey = currentKey;
										expectedDiscriminators = [];
									}
									if (invalidDiscriminatorKey === currentKey) expectedDiscriminators.push(schema.entries[currentKey].expects);
									break;
								}
								currentPriority++;
							}
							if (keysAreValid) {
								const optionDataset = schema["~run"]({ value: input }, config$1);
								if (!outputDataset || !outputDataset.typed && optionDataset.typed) outputDataset = optionDataset;
							}
						}
						if (outputDataset && !outputDataset.issues) break;
					}
				};
				parseOptions(this, /* @__PURE__ */ new Set([this.key]));
				if (outputDataset) return outputDataset;
				_addIssue(this, "type", dataset, config$1, {
					input: input[invalidDiscriminatorKey],
					expected: /* @__PURE__ */ _joinExpects(expectedDiscriminators, "|"),
					path: [{
						type: "object",
						origin: "value",
						input,
						key: invalidDiscriminatorKey,
						value: input[invalidDiscriminatorKey]
					}]
				});
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/**
* Parses an unknown input based on a schema.
*
* @param schema The schema to be used.
* @param input The input to be parsed.
* @param config The parse configuration.
*
* @returns The parsed input.
*/
function parse(schema, input, config$1) {
	const dataset = schema["~run"]({ value: input }, /* @__PURE__ */ getGlobalConfig(config$1));
	if (dataset.issues) throw new ValiError(dataset.issues);
	return dataset.value;
}
/* @__NO_SIDE_EFFECTS__ */
function pipe(...pipe$1) {
	return _standardSchema({
		...pipe$1[0],
		pipe: pipe$1,
		"~run"(dataset, config$1) {
			for (const item of pipe$1) if (item.kind !== "metadata") {
				if (dataset.issues && (item.kind === "schema" || item.kind === "transformation")) {
					dataset.typed = false;
					break;
				}
				if (!dataset.issues || !config$1.abortEarly && !config$1.abortPipeEarly) dataset = item["~run"](dataset, config$1);
			}
			return dataset;
		}
	});
}
/**
* Parses an unknown input based on a schema.
*
* @param schema The schema to be used.
* @param input The input to be parsed.
* @param config The parse configuration.
*
* @returns The parse result.
*/
/* @__NO_SIDE_EFFECTS__ */
function safeParse(schema, input, config$1) {
	const dataset = schema["~run"]({ value: input }, /* @__PURE__ */ getGlobalConfig(config$1));
	return {
		typed: dataset.typed,
		success: !dataset.issues,
		output: dataset.value,
		issues: dataset.issues
	};
}
/**
* Summarize the error messages of issues in a pretty-printable multi-line string.
*
* @param issues The list of issues.
*
* @returns A summary of the issues.
*
* @beta
*/
/* @__NO_SIDE_EFFECTS__ */
function summarize(issues) {
	let summary = "";
	for (const issue of issues) {
		if (summary) summary += "\n";
		summary += `× ${issue.message}`;
		const dotPath = /* @__PURE__ */ getDotPath(issue);
		if (dotPath) summary += `\n  → at ${dotPath}`;
	}
	return summary;
}
//#endregion
//#region protocol/dist/scopes.js
const SCOPES = [
	"view",
	"control_profiles",
	"approve_ai",
	"approve_team",
	"totp",
	"phone_profiles_linked"
];
/** Scope needed for each command name. */
const COMMAND_SCOPES = Object.freeze({
	"profile.start": "control_profiles",
	"profile.stop": "control_profiles",
	"profile.restart": "control_profiles",
	"approval.answer": "approve_ai",
	"team.request": "view",
	"team.decide": "approve_team",
	"totp.request": "totp",
	"state.request": "view"
});
/** Default scopes for the owner's own phone. Members get role-derived scopes from the PC. */
const OWNER_DEFAULT_SCOPES = Object.freeze([...SCOPES]);
function isScope(value) {
	return typeof value === "string" && SCOPES.includes(value);
}
function parseScopes(values) {
	if (!Array.isArray(values)) return ["view"];
	const set = /* @__PURE__ */ new Set(["view"]);
	for (const s of values) if (isScope(s)) set.add(s);
	return SCOPES.filter((s) => set.has(s));
}
/**
* Scope a message from a phone needs on the PC, or null when the message is not something a
* phone may send at all (state, alerts and approval requests flow PC to phone only).
*/
function requiredScope(msg) {
	switch (msg.type) {
		case "hello":
		case "result":
		case "revoke": return "view";
		case "command": return COMMAND_SCOPES[msg.body.name];
		case "lease": return "phone_profiles_linked";
		default: return null;
	}
}
/** Check a phone-originated message against the device scopes. Unknown direction = forbidden. */
function checkScope(scopes, msg) {
	const required = requiredScope(msg);
	return {
		allowed: required !== null && scopes.includes(required),
		required
	};
}
function commandAllowed(scopes, command) {
	return scopes.includes(COMMAND_SCOPES[command.name]);
}
//#endregion
//#region protocol/dist/messages.js
const PROTOCOL_VERSION = 1;
/** The PC accepts the current and the previous protocol version (MOBILE-PLAN 3.2). */
const MIN_SUPPORTED_VERSION = 1;
const Id$1 = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Za-z0-9_-]{8,64}$/));
const Ts = /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0));
const ShortText = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(200));
const LongText = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(2e3));
const Count = /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0));
const PLATFORMS = [
	"ios",
	"android",
	"windows",
	"macos",
	"linux"
];
const PROFILE_STATUSES = [
	"running",
	"starting",
	"stopping",
	"stopped",
	"crashed",
	"proxy_dead",
	"slow_proxy",
	"logged_out",
	"waiting"
];
const APPROVAL_DECISIONS = [
	"allow_once",
	"allow_1h",
	"deny"
];
const TEAM_REQUEST_KINDS = [
	"profile.use",
	"totp.reveal",
	"cookie.export",
	"group.start"
];
const ALERT_KINDS = [
	"profile_crashed",
	"proxy_dead",
	"proxy_slow",
	"blocked_page",
	"logged_out",
	"run_finished",
	"run_failed",
	"licence_ending",
	"device_paired",
	"device_revoked",
	"lease_taken_over",
	"totp_revealed",
	"pc_offline"
];
const RESULT_CODES = [
	"ok",
	"forbidden",
	"not_found",
	"expired",
	"in_use",
	"busy",
	"invalid",
	"limit",
	"unsupported",
	"error"
];
const LEASE_OPS = [
	"acquire",
	"renew",
	"release",
	"takeover",
	"granted",
	"denied",
	"lost"
];
const DeviceInfoSchema = /* @__PURE__ */ object({
	name: ShortText,
	platform: /* @__PURE__ */ picklist(PLATFORMS),
	appVersion: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(40))
});
const ProfileSummarySchema = /* @__PURE__ */ object({
	id: Id$1,
	title: ShortText,
	status: /* @__PURE__ */ picklist(PROFILE_STATUSES),
	group: /* @__PURE__ */ optional(ShortText),
	tags: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ array(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(60))), /* @__PURE__ */ maxLength(50))),
	proxyCountry: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Z]{2}$/))),
	member: /* @__PURE__ */ optional(ShortText),
	lastUsedAt: /* @__PURE__ */ optional(Ts),
	leaseHolder: /* @__PURE__ */ optional(ShortText)
});
const CountsSchema = /* @__PURE__ */ object({ pending: Count });
const HelloBody = /* @__PURE__ */ object({
	device: DeviceInfoSchema,
	protocol: /* @__PURE__ */ object({
		min: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ integer()),
		max: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ integer())
	}),
	/** PC to phone after the user confirmed the codes: the id the PC gave this phone and its scopes. */
	deviceId: /* @__PURE__ */ optional(ShortText),
	scopes: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ array(/* @__PURE__ */ picklist(SCOPES)), /* @__PURE__ */ maxLength(SCOPES.length)))
});
const SnapshotBody = /* @__PURE__ */ object({
	rev: Count,
	pcName: ShortText,
	profiles: /* @__PURE__ */ pipe(/* @__PURE__ */ array(ProfileSummarySchema), /* @__PURE__ */ maxLength(5e3)),
	alerts: /* @__PURE__ */ object({ open: Count }),
	approvals: CountsSchema
});
const PatchBody = /* @__PURE__ */ object({
	rev: Count,
	baseRev: Count,
	upsert: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ array(ProfileSummarySchema), /* @__PURE__ */ maxLength(5e3))),
	remove: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ array(Id$1), /* @__PURE__ */ maxLength(5e3))),
	alerts: /* @__PURE__ */ optional(/* @__PURE__ */ object({ open: Count })),
	approvals: /* @__PURE__ */ optional(CountsSchema)
});
const ProfileIds = /* @__PURE__ */ pipe(/* @__PURE__ */ array(Id$1), /* @__PURE__ */ minLength(1), /* @__PURE__ */ maxLength(200));
const CommandSchema = /* @__PURE__ */ variant("name", [
	/* @__PURE__ */ object({
		name: /* @__PURE__ */ literal("profile.start"),
		profileIds: ProfileIds
	}),
	/* @__PURE__ */ object({
		name: /* @__PURE__ */ literal("profile.stop"),
		profileIds: ProfileIds
	}),
	/* @__PURE__ */ object({
		name: /* @__PURE__ */ literal("profile.restart"),
		profileIds: ProfileIds
	}),
	/* @__PURE__ */ object({
		name: /* @__PURE__ */ literal("approval.answer"),
		approvalId: Id$1,
		decision: /* @__PURE__ */ picklist(APPROVAL_DECISIONS)
	}),
	/* @__PURE__ */ object({
		name: /* @__PURE__ */ literal("team.request"),
		kind: /* @__PURE__ */ picklist(TEAM_REQUEST_KINDS),
		targetId: Id$1,
		durationMin: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ integer(), /* @__PURE__ */ minValue(1), /* @__PURE__ */ maxValue(10080))),
		note: /* @__PURE__ */ optional(ShortText)
	}),
	/* @__PURE__ */ object({
		name: /* @__PURE__ */ literal("team.decide"),
		requestId: Id$1,
		decision: /* @__PURE__ */ picklist(["approve", "deny"]),
		durationMin: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ integer(), /* @__PURE__ */ minValue(1), /* @__PURE__ */ maxValue(10080))),
		note: /* @__PURE__ */ optional(ShortText)
	}),
	/* @__PURE__ */ object({
		name: /* @__PURE__ */ literal("totp.request"),
		entryId: Id$1
	}),
	/* @__PURE__ */ object({ name: /* @__PURE__ */ literal("state.request") })
]);
const CommandBody = CommandSchema;
const ResultBody = /* @__PURE__ */ object({
	re: Id$1,
	ok: /* @__PURE__ */ boolean(),
	code: /* @__PURE__ */ picklist(RESULT_CODES),
	message: /* @__PURE__ */ optional(ShortText),
	/** Small structured result, e.g. { code: '123456', validFor: 17 } for a TOTP request. */
	data: /* @__PURE__ */ optional(/* @__PURE__ */ record(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(64)), /* @__PURE__ */ unknown()))
});
const AlertBody = /* @__PURE__ */ object({
	alertId: Id$1,
	kind: /* @__PURE__ */ picklist(ALERT_KINDS),
	severity: /* @__PURE__ */ picklist([
		"info",
		"warning",
		"critical"
	]),
	title: ShortText,
	detail: /* @__PURE__ */ optional(LongText),
	profileId: /* @__PURE__ */ optional(Id$1),
	at: Ts
});
const ApprovalRequestBody = /* @__PURE__ */ object({
	approvalId: Id$1,
	tool: ShortText,
	summary: LongText,
	clientName: /* @__PURE__ */ optional(ShortText),
	memberName: /* @__PURE__ */ optional(ShortText),
	/** Arguments already redacted by the PC (sanitizeFrame). */
	args: /* @__PURE__ */ optional(/* @__PURE__ */ record(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(64)), /* @__PURE__ */ unknown())),
	allowHour: /* @__PURE__ */ boolean(),
	expiresAt: Ts
});
const LeaseBody = /* @__PURE__ */ object({
	op: /* @__PURE__ */ picklist(LEASE_OPS),
	profileId: Id$1,
	epoch: Count,
	holderDeviceId: /* @__PURE__ */ optional(ShortText),
	expiresAt: /* @__PURE__ */ optional(Ts)
});
const RevokeBody = /* @__PURE__ */ object({
	deviceId: ShortText,
	reason: /* @__PURE__ */ optional(/* @__PURE__ */ picklist([
		"revoked_on_pc",
		"unpaired_on_phone",
		"account_sign_out",
		"member_removed"
	]))
});
const base = {
	v: /* @__PURE__ */ literal(1),
	id: Id$1,
	ts: Ts
};
const MessageSchema = /* @__PURE__ */ variant("type", [
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("hello"),
		body: HelloBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("state.snapshot"),
		body: SnapshotBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("state.patch"),
		body: PatchBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("command"),
		body: CommandBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("result"),
		body: ResultBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("alert"),
		body: AlertBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("approval_request"),
		body: ApprovalRequestBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("lease"),
		body: LeaseBody
	}),
	/* @__PURE__ */ object({
		...base,
		type: /* @__PURE__ */ literal("revoke"),
		body: RevokeBody
	})
]);
/** Messages that change something on the PC: they get the 60 s max age rule. */
const COMMAND_TYPES = /* @__PURE__ */ new Set(["command", "lease"]);
var ValidationError = class extends Error {
	issues;
	constructor(issues) {
		super(`Invalid message: ${issues}`);
		this.issues = issues;
		this.name = "ValidationError";
	}
};
function validateMessage(input) {
	const r = /* @__PURE__ */ safeParse(MessageSchema, input);
	if (!r.success) throw new ValidationError(/* @__PURE__ */ summarize(r.issues));
	return r.output;
}
function isValidMessage(input) {
	return (/* @__PURE__ */ safeParse(MessageSchema, input)).success;
}
/** UUIDv7 (time ordered), base64url-free canonical text form. */
function uuidv7(now = Date.now()) {
	const b = randomBytes(16);
	let t = BigInt(now);
	for (let i = 5; i >= 0; i--) {
		b[i] = Number(t & 255n);
		t >>= 8n;
	}
	b[6] = b[6] & 15 | 112;
	b[8] = b[8] & 63 | 128;
	const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Message id: 16 random bytes, base64url (22 chars). Fits the Id pattern. */
function newMessageId() {
	return toBase64Url(randomBytes(16));
}
/** Build and validate a message. */
function createMessage(type, body, opts = {}) {
	return validateMessage({
		v: 1,
		id: opts.id ?? newMessageId(),
		ts: opts.now ?? Date.now(),
		type,
		body
	});
}
//#endregion
//#region protocol/dist/session.js
const COMMAND_MAX_AGE_MS = 6e4;
const MAX_FUTURE_SKEW_MS = 3e4;
const REPLAY_WINDOW = 1024;
const SEEN_ID_TTL_MS = 10 * 6e4;
const REKEY_AFTER_MESSAGES = 1e5;
const REKEY_AFTER_MS = 60 * 6e4;
const SESSION_HEADER_LEN = 18;
/** Remembers message ids for a while; shared by all sessions and sealed messages on one device. */
var SeenCache = class {
	ttlMs;
	maxEntries;
	ids = /* @__PURE__ */ new Map();
	constructor(ttlMs = SEEN_ID_TTL_MS, maxEntries = 1e5) {
		this.ttlMs = ttlMs;
		this.maxEntries = maxEntries;
	}
	/** Returns true the first time an id is seen, false for a repeat. */
	remember(id, now) {
		this.prune(now);
		const exp = this.ids.get(id);
		if (exp !== void 0 && exp > now) return false;
		this.ids.set(id, now + this.ttlMs);
		if (this.ids.size > this.maxEntries) {
			const first = this.ids.keys().next();
			if (!first.done) this.ids.delete(first.value);
		}
		return true;
	}
	prune(now) {
		for (const [id, exp] of this.ids) {
			if (exp > now) break;
			this.ids.delete(id);
		}
	}
	get size() {
		return this.ids.size;
	}
};
/** Sliding window over received sequence numbers (like IPsec / WireGuard). */
var ReplayWindow = class {
	size;
	max = -1n;
	seen = /* @__PURE__ */ new Set();
	constructor(size = BigInt(REPLAY_WINDOW)) {
		this.size = size;
	}
	/** True when seq is new and inside the window. Does not record it. */
	check(seq) {
		if (seq > this.max) return true;
		if (this.max - seq >= this.size) return false;
		return !this.seen.has(seq);
	}
	record(seq) {
		if (seq > this.max) {
			this.max = seq;
			const floor = this.max - this.size;
			for (const s of this.seen) if (s <= floor) this.seen.delete(s);
		}
		this.seen.add(seq);
	}
};
/** Shared freshness checks for any decrypted message. */
function checkFreshness(msg, opts) {
	const now = opts.now ?? Date.now();
	const skew = opts.maxFutureSkewMs ?? 3e4;
	if (msg.ts > now + skew) throw new ProtocolError("future", "Message timestamp is in the future.");
	const maxAge = COMMAND_TYPES.has(msg.type) ? opts.maxCommandAgeMs ?? 6e4 : opts.maxAgeMs;
	if (maxAge !== void 0 && now - msg.ts > maxAge) throw new ProtocolError("expired", "Message is too old.");
	if (opts.seen && !opts.seen.remember(msg.id, now)) throw new ProtocolError("replay", "Message id already seen.");
}
function encodeMessage(msg) {
	return pad(utf8Encode(JSON.stringify(validateMessage(msg))));
}
function decodeMessage(padded) {
	let parsed;
	try {
		parsed = JSON.parse(utf8Decode(unpad(padded)));
	} catch {
		throw new ProtocolError("invalid", "Message is not valid JSON.");
	}
	try {
		return validateMessage(parsed);
	} catch (e) {
		throw new ProtocolError("invalid", e.message);
	}
}
var Session = class {
	role;
	sessionId;
	handshakeHash;
	peerStatic;
	createdAt;
	sendKey;
	recvKey;
	sendSeq = 0n;
	window = new ReplayWindow();
	closed = false;
	constructor(p) {
		if (p.sessionId.length !== 8) throw new Error("Session id must be 8 bytes.");
		this.role = p.role;
		this.sessionId = p.sessionId.slice();
		this.handshakeHash = p.handshakeHash.slice();
		this.peerStatic = p.peerStatic.slice();
		this.createdAt = p.now ?? Date.now();
		this.sendKey = (p.role === "initiator" ? p.initiatorToResponder : p.responderToInitiator).slice();
		this.recvKey = (p.role === "initiator" ? p.responderToInitiator : p.initiatorToResponder).slice();
	}
	get sessionIdHex() {
		return bytesToHex(this.sessionId);
	}
	get messagesSent() {
		return Number(this.sendSeq);
	}
	needsRekey(now = Date.now()) {
		return this.sendSeq >= BigInt(1e5) || now - this.createdAt >= 36e5;
	}
	/** Encrypt one message into a Session envelope. */
	seal(msg) {
		if (this.closed) throw new ProtocolError("invalid", "Session closed.");
		if (this.sendSeq > MAX_NONCE) throw new ProtocolError("rekey", "Session exhausted.");
		const seq = this.sendSeq++;
		const hdr = header(EnvelopeKind.Session, this.sessionId, u64be(seq));
		return concat(hdr, aeadEncrypt(this.sendKey, seq, hdr, encodeMessage(msg)));
	}
	/** Decrypt and validate one Session envelope. Throws ProtocolError. */
	open(envelope, opts = {}) {
		if (this.closed) throw new ProtocolError("invalid", "Session closed.");
		let kind;
		try {
			kind = peekEnvelope(envelope).kind;
		} catch (e) {
			throw new ProtocolError("invalid", e.message);
		}
		if (kind !== EnvelopeKind.Session || envelope.length < 34) throw new ProtocolError("invalid", "Not a session envelope.");
		const hdr = envelope.subarray(0, SESSION_HEADER_LEN);
		const sid = envelope.subarray(2, 10);
		for (let i = 0; i < 8; i++) if (sid[i] !== this.sessionId[i]) throw new ProtocolError("wrong_session");
		const seq = readU64be(envelope, 10);
		if (seq > MAX_NONCE) throw new ProtocolError("invalid", "Bad sequence number.");
		if (!this.window.check(seq)) throw new ProtocolError("replay", "Sequence number replayed or too old.");
		let padded;
		try {
			padded = aeadDecrypt(this.recvKey, seq, hdr, envelope.subarray(SESSION_HEADER_LEN));
		} catch {
			throw new ProtocolError("tampered", "Envelope failed authentication.");
		}
		this.window.record(seq);
		const msg = decodeMessage(padded);
		checkFreshness(msg, opts);
		return msg;
	}
	close() {
		this.closed = true;
		wipe(this.sendKey, this.recvKey);
	}
};
//#endregion
//#region @noble/hashes/hkdf.js
/**
* HKDF (RFC 5869): extract + expand in one step.
* See {@link https://soatok.blog/2021/11/17/understanding-hkdf/}.
* @module
*/
const HKDF_COUNTER = /* @__PURE__ */ Uint8Array.of(0);
const EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
/**
* HKDF-expand from the spec. The most important part. `HKDF-Expand(PRK, info, L) -> OKM`
* @param hash - hash function that would be used (e.g. sha256)
* @param prk - a pseudorandom key of at least HashLen octets
*   (usually, the output from the extract step)
* @param info - optional context and application specific information (can be a zero-length string)
* @param length - length of output keying material in bytes.
*   RFC 5869 §2.3 allows `0..255*HashLen`, so `0` returns an empty OKM.
* @param _recycled - Internal destroyed extract hashes owned by the combined `hkdf()` call.
* @returns Output keying material with the requested length.
* @throws If the requested output length exceeds the HKDF limit
*   for the selected hash. {@link Error}
* @example
* Run the HKDF expand step.
* ```ts
* import { expand } from '@noble/hashes/hkdf.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* expand(sha256, new Uint8Array(32), new Uint8Array([1, 2, 3]), 16);
* ```
*/
function expand(hash, prk, info, length = 32, _recycled) {
	ahash(hash);
	anumber$2(length, "length");
	abytes$2(prk, void 0, "prk");
	const olen = hash.outputLen;
	if (prk.length < olen) throw new Error("\"prk\" must be at least HashLen octets");
	if (length > 255 * olen) throw new Error("Length must be <= 255*HashLen");
	const blocks = Math.ceil(length / olen);
	if (info === void 0) info = EMPTY_BUFFER;
	else abytes$2(info, void 0, "info");
	if (!blocks) {
		if (_recycled) clean$1(prk);
		return /* @__PURE__ */ new Uint8Array();
	}
	const okm = _recycled && blocks === 1 ? prk : new Uint8Array(blocks * olen);
	const { iHash, oHash } = hmac.create(hash, prk);
	const T = _recycled ? prk : new Uint8Array(olen);
	const worker = blocks > 1 ? _recycled?.iHash || hash.create() : void 0;
	for (let counter = 0; counter < blocks - 1; counter++) {
		HKDF_COUNTER[0] = counter + 1;
		const iWork = iHash._cloneInto(worker);
		if (counter) iWork.update(T);
		iWork.update(info).update(HKDF_COUNTER).digestInto(T);
		oHash._cloneInto(worker).update(T).digestInto(T);
		okm.set(T, olen * counter);
	}
	HKDF_COUNTER[0] = blocks;
	if (blocks > 1) iHash.update(T);
	iHash.update(info).update(HKDF_COUNTER).digestInto(T);
	oHash.update(T).digestInto(T);
	okm.set(T, olen * (blocks - 1));
	iHash.destroy();
	oHash.destroy();
	worker?.destroy();
	if (T !== okm) clean$1(T);
	clean$1(HKDF_COUNTER);
	if (length === okm.length) return okm;
	const res = okm.slice(0, length);
	clean$1(okm);
	return res;
}
/**
* HKDF (RFC 5869): derive keys from an initial input.
* Combines hkdf_extract + hkdf_expand in one step
* @param hash - hash function that would be used (e.g. sha256)
* @param ikm - input keying material, the initial key
* @param salt - optional salt value (a non-secret random value)
* @param info - optional context and application specific information bytes
* @param length - length of output keying material in bytes.
*   RFC 5869 §2.3 allows `0..255*HashLen`, so `0` returns an empty OKM.
* @returns Output keying material derived from the input key.
* @throws If the requested output length exceeds the HKDF limit
*   for the selected hash. {@link Error}
* @example
* HKDF (RFC 5869): derive keys from an initial input.
* ```ts
* import { hkdf } from '@noble/hashes/hkdf.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
* const inputKey = randomBytes(32);
* const salt = randomBytes(32);
* const info = utf8ToBytes('application-key');
* const okm = hkdf(sha256, inputKey, salt, info, 32);
* ```
*/
const hkdf = (hash, ikm, salt, info, length) => {
	ahash(hash);
	if (salt === void 0) salt = new Uint8Array(hash.outputLen);
	const HMAC = hmac.create(hash, salt).update(ikm);
	return expand(hash, HMAC.digest(), info, length, HMAC);
};
//#endregion
//#region protocol/dist/pairing.js
const PAIRING_TTL_MS = 5 * 6e4;
const PAIRING_MAX_ATTEMPTS = 10;
const QR_PREFIX = "sgpair";
const QR_VERSION = 1;
const MAX_QR_EXPIRY_AHEAD_MS = 10 * 6e4;
const MAX_RELAY_URL_LEN = 200;
const RELAY_URL_RE = /^(wss?):\/\/([A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:]{2,39}\])(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
const LOCAL_HOSTS = /* @__PURE__ */ new Set([
	"localhost",
	"127.0.0.1",
	"[::1]"
]);
/** Validates a relay URL: wss only, ws only for localhost (tests and LAN development). */
function validateRelayUrl(url) {
	if (typeof url !== "string" || url.length > MAX_RELAY_URL_LEN) throw new ProtocolError("invalid", "Bad relay URL.");
	const m = RELAY_URL_RE.exec(url);
	if (!m) throw new ProtocolError("invalid", "Bad relay URL.");
	if (m[1] === "ws" && !LOCAL_HOSTS.has(m[2].toLowerCase())) throw new ProtocolError("invalid", "Relay URL must use wss://.");
	if (m[3] && Number(m[3].slice(1)) > 65535) throw new ProtocolError("invalid", "Bad relay port.");
	return url;
}
function encodePairingPayload(p) {
	validateRelayUrl(p.relayUrl);
	if (p.secret.length !== 16 || p.pcDhPub.length !== 32 || p.pcSignPub.length !== 32) throw new Error("Bad pairing keys.");
	return [
		QR_PREFIX,
		String(1),
		toBase64Url(utf8Encode(p.relayUrl)),
		p.pcMailboxId,
		toBase64Url(p.pcDhPub),
		toBase64Url(p.pcSignPub),
		toBase64Url(p.secret),
		String(Math.floor(p.expiresAt / 1e3))
	].join(":");
}
/** Parses and validates a scanned QR. Throws ProtocolError('expired') for an old QR. */
function decodePairingPayload(text, now = Date.now()) {
	if (typeof text !== "string" || text.length > 600) throw new ProtocolError("invalid", "Not a SoftGlaze pairing code.");
	const parts = text.trim().split(":");
	if (parts.length !== 8 || parts[0] !== "sgpair") throw new ProtocolError("invalid", "Not a SoftGlaze pairing code.");
	if (parts[1] !== String(1)) throw new ProtocolError("invalid", "Unsupported pairing code version. Update SoftGlaze.");
	let relayUrl, pcDhPub, pcSignPub, secret;
	try {
		relayUrl = utf8Decode(fromBase64Url(parts[2]));
		pcDhPub = fromBase64Url(parts[4]);
		pcSignPub = fromBase64Url(parts[5]);
		secret = fromBase64Url(parts[6]);
	} catch {
		throw new ProtocolError("invalid", "Damaged pairing code.");
	}
	validateRelayUrl(relayUrl);
	const pcMailboxId = parts[3];
	if (!MAILBOX_ID_RE.test(pcMailboxId)) throw new ProtocolError("invalid", "Bad mailbox id.");
	if (pcDhPub.length !== 32 || pcSignPub.length !== 32 || secret.length !== 16) throw new ProtocolError("invalid", "Bad key length.");
	if (mailboxIdFromSignKey(pcSignPub) !== pcMailboxId) throw new ProtocolError("invalid", "Mailbox id does not match the PC key.");
	if (!/^\d{1,12}$/.test(parts[7])) throw new ProtocolError("invalid", "Bad expiry.");
	const expiresAt = Number(parts[7]) * 1e3;
	if (now >= expiresAt) throw new ProtocolError("expired", "This pairing code has expired. Show a new one on the PC.");
	if (expiresAt - now > MAX_QR_EXPIRY_AHEAD_MS) throw new ProtocolError("invalid", "Pairing code expiry is too far ahead. Check the clock.");
	return {
		version: 1,
		relayUrl,
		pcMailboxId,
		pcDhPub,
		pcSignPub,
		secret,
		expiresAt
	};
}
const te = (s) => utf8Encode(s);
function pairingIdFromSecret(secret) {
	return hkdf(sha256, secret, void 0, te("sg-pair-id-v1"), 8);
}
function pskFromSecret(secret) {
	return hkdf(sha256, secret, void 0, te("sg-pair-psk-v1"), 32);
}
function pairingPrologue(pairingId, pcMailboxId, relayUrl) {
	return concat(te("sg-pair-v1\n"), pairingId, te(`\n${pcMailboxId}\n${relayUrl}`));
}
/** 6-digit short authentication string from the handshake hash. */
function computeSas(handshakeHash) {
	const b = hkdf(sha256, handshakeHash, void 0, te("sg-sas-v1"), 4);
	return String(readU32be(b) % 1e6).padStart(6, "0");
}
/** Constant-time compare of two 6-digit codes. */
function sasMatches(a, b) {
	return /^\d{6}$/.test(a) && /^\d{6}$/.test(b) && equalStrings(a, b);
}
const PairHelloSchema = /* @__PURE__ */ object({
	v: /* @__PURE__ */ literal(1),
	device: DeviceInfoSchema,
	signPub: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Za-z0-9_-]{43}$/)),
	mailboxId: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(MAILBOX_ID_RE)),
	ts: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger())
});
function encodeHello(identity, device, now) {
	const hello = {
		v: 1,
		device,
		signPub: toBase64Url(identity.sign.publicKey),
		mailboxId: identity.mailboxId,
		ts: now
	};
	return te(JSON.stringify(parse(PairHelloSchema, hello)));
}
function decodeHello(bytes, dhPub, now, maxAgeMs) {
	let parsed;
	try {
		parsed = parse(PairHelloSchema, JSON.parse(utf8Decode(bytes)));
	} catch {
		throw new ProtocolError("invalid", "Bad handshake payload.");
	}
	const signPub = fromBase64Url(parsed.signPub);
	if (signPub.length !== 32 || mailboxIdFromSignKey(signPub) !== parsed.mailboxId) throw new ProtocolError("invalid", "Mailbox id does not match key.");
	if (parsed.ts > now + 3e4) throw new ProtocolError("future", "Handshake from the future.");
	if (now - parsed.ts > maxAgeMs) throw new ProtocolError("expired", "Handshake too old.");
	return {
		dhPub: dhPub.slice(),
		signPub,
		mailboxId: parsed.mailboxId,
		device: parsed.device
	};
}
/** One QR offer on the PC. Single use, 5 minutes, at most 10 failed attempts. */
var PairingOffer = class PairingOffer {
	payload;
	pairingId;
	secret;
	used = false;
	attempts = 0;
	constructor(payload) {
		this.payload = payload;
		this.secret = payload.secret;
		this.pairingId = pairingIdFromSecret(payload.secret);
	}
	static create(opts) {
		const now = opts.now ?? Date.now();
		const ttl = Math.min(opts.ttlMs ?? 3e5, PAIRING_TTL_MS);
		const expiresAt = Math.floor((now + ttl) / 1e3) * 1e3;
		return new PairingOffer({
			version: 1,
			relayUrl: validateRelayUrl(opts.relayUrl),
			pcMailboxId: opts.identity.mailboxId,
			pcDhPub: opts.identity.dh.publicKey,
			pcSignPub: opts.identity.sign.publicKey,
			secret: randomBytes(16),
			expiresAt
		});
	}
	/** Text for the QR code. */
	get qrText() {
		return encodePairingPayload(this.payload);
	}
	get pairingIdB64() {
		return toBase64Url(this.pairingId);
	}
	isOpen(now = Date.now()) {
		return !this.used && this.attempts < 10 && now < this.payload.expiresAt;
	}
	/** Burn the offer without pairing (user closed the QR dialog). */
	cancel() {
		this.used = true;
		wipe(this.secret);
	}
	/**
	* Handle the phone's PairInit envelope. Returns the PairResp envelope to send back and the
	* session. The offer is burned on success. The PC must still show `sas` and wait for the user
	* to confirm before trusting the phone.
	*/
	respond(envelope, opts) {
		const now = opts.now ?? Date.now();
		if (this.used) throw new ProtocolError("used", "This pairing code was already used.");
		if (now >= this.payload.expiresAt) throw new ProtocolError("expired", "This pairing code has expired.");
		if (this.attempts >= 10) throw new ProtocolError("used", "Too many attempts. Show a new code.");
		const id = pairIdOf(envelope, EnvelopeKind.PairInit);
		if (!id || !equalBytesShort(id, this.pairingId)) throw new ProtocolError("wrong_session", "Envelope is for another pairing code.");
		this.attempts++;
		const hs = new Handshake({
			pattern: "IKpsk1",
			initiator: false,
			prologue: pairingPrologue(this.pairingId, this.payload.pcMailboxId, this.payload.relayUrl),
			s: opts.identity.dh,
			psk: pskFromSecret(this.secret)
		});
		let p1;
		try {
			p1 = hs.readMessage1(envelope.subarray(10));
		} catch {
			throw new ProtocolError("tampered", "Pairing message failed authentication.");
		}
		const peer = decodeHello(p1, hs.remoteStatic(), now, PAIRING_TTL_MS);
		const m2 = hs.writeMessage2(encodeHello(opts.identity, opts.device, now));
		const r = hs.result();
		this.used = true;
		wipe(this.secret);
		const session = new Session({
			role: "responder",
			sessionId: this.pairingId,
			initiatorToResponder: r.initiatorToResponder,
			responderToInitiator: r.responderToInitiator,
			handshakeHash: r.handshakeHash,
			peerStatic: r.remoteStatic,
			now
		});
		return {
			envelope: concat(header(EnvelopeKind.PairResp, this.pairingId), m2),
			result: {
				session,
				sas: computeSas(r.handshakeHash),
				peer
			}
		};
	}
};
function equalBytesShort(a, b) {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
	return d === 0;
}
function pairIdOf(envelope, kind) {
	try {
		if (peekEnvelope(envelope).kind !== kind || envelope.length < 10) return null;
	} catch {
		return null;
	}
	return envelope.subarray(2, 10);
}
/** Pairing id (base64url) of a PairInit envelope, so the PC can find the matching offer. */
function pairingIdOfEnvelope(envelope) {
	const id = pairIdOf(envelope, EnvelopeKind.PairInit);
	return id ? toBase64Url(id) : null;
}
function startPairing(opts) {
	const now = opts.now ?? Date.now();
	const p = opts.payload;
	if (now >= p.expiresAt) throw new ProtocolError("expired", "This pairing code has expired.");
	const pairingId = pairingIdFromSecret(p.secret);
	const hs = new Handshake({
		pattern: "IKpsk1",
		initiator: true,
		prologue: pairingPrologue(pairingId, p.pcMailboxId, p.relayUrl),
		s: opts.identity.dh,
		rs: p.pcDhPub,
		psk: pskFromSecret(p.secret)
	});
	const m1 = hs.writeMessage1(encodeHello(opts.identity, opts.device, now));
	let finished = false;
	return {
		envelope: concat(header(EnvelopeKind.PairInit, pairingId), m1),
		pairingId: toBase64Url(pairingId),
		finish(envelope2, at) {
			if (finished) throw new ProtocolError("used", "Pairing already finished.");
			const t = at ?? Date.now();
			const id = pairIdOf(envelope2, EnvelopeKind.PairResp);
			if (!id || !equalBytesShort(id, pairingId)) throw new ProtocolError("wrong_session", "Reply is for another pairing.");
			let p2;
			try {
				p2 = hs.readMessage2(envelope2.subarray(10));
			} catch {
				throw new ProtocolError("tampered", "Pairing reply failed authentication.");
			}
			const peer = decodeHello(p2, p.pcDhPub, t, PAIRING_TTL_MS);
			if (peer.mailboxId !== p.pcMailboxId) throw new ProtocolError("invalid", "PC mailbox does not match the QR.");
			if (!equalBytesShort(peer.signPub, p.pcSignPub)) throw new ProtocolError("invalid", "PC key does not match the QR.");
			const r = hs.result();
			finished = true;
			return {
				session: new Session({
					role: "initiator",
					sessionId: pairingId,
					initiatorToResponder: r.initiatorToResponder,
					responderToInitiator: r.responderToInitiator,
					handshakeHash: r.handshakeHash,
					peerStatic: r.remoteStatic,
					now: t
				}),
				sas: computeSas(r.handshakeHash),
				peer
			};
		}
	};
}
function sessionPrologue(sid) {
	return concat(te("sg-session-v1\n"), sid);
}
/** Initiator (usually the phone) opens a fresh session with a paired peer. */
function startSession(opts) {
	const now = opts.now ?? Date.now();
	const sid = randomBytes(8);
	const hs = new Handshake({
		pattern: "IK",
		initiator: true,
		prologue: sessionPrologue(sid),
		s: opts.identity.dh,
		rs: opts.peerDhPub
	});
	const m1 = hs.writeMessage1(te(JSON.stringify({
		v: 1,
		ts: now
	})));
	let finished = false;
	return {
		envelope: concat(header(EnvelopeKind.SessionInit, sid), m1),
		sessionId: toBase64Url(sid),
		finish(envelope2, at) {
			if (finished) throw new ProtocolError("used");
			try {
				if (peekEnvelope(envelope2).kind !== EnvelopeKind.SessionResp) throw new Error();
			} catch {
				throw new ProtocolError("invalid", "Not a session reply.");
			}
			if (!equalBytesShort(envelope2.subarray(2, 10), sid)) throw new ProtocolError("wrong_session");
			try {
				hs.readMessage2(envelope2.subarray(10));
			} catch {
				throw new ProtocolError("tampered", "Session reply failed authentication.");
			}
			const r = hs.result();
			finished = true;
			return new Session({
				role: "initiator",
				sessionId: sid,
				...r,
				peerStatic: r.remoteStatic,
				now: at ?? Date.now()
			});
		}
	};
}
/**
* Responder side of a reconnect. `isPaired` must return true only for a paired, not revoked
* device key. Returns the reply envelope and the session.
*/
function acceptSession(opts) {
	const now = opts.now ?? Date.now();
	const env = opts.envelope;
	try {
		if (peekEnvelope(env).kind !== EnvelopeKind.SessionInit || env.length < 10) throw new Error();
	} catch {
		throw new ProtocolError("invalid", "Not a session request.");
	}
	const sid = env.subarray(2, 10).slice();
	const hs = new Handshake({
		pattern: "IK",
		initiator: false,
		prologue: sessionPrologue(sid),
		s: opts.identity.dh
	});
	let p1;
	try {
		p1 = hs.readMessage1(env.subarray(10));
	} catch {
		throw new ProtocolError("tampered", "Session request failed authentication.");
	}
	const rs = hs.remoteStatic();
	if (!opts.isPaired(rs)) throw new ProtocolError("unknown_sender", "Device is not paired or was revoked.");
	let ts;
	try {
		ts = JSON.parse(utf8Decode(p1)).ts;
	} catch {
		throw new ProtocolError("invalid");
	}
	if (typeof ts !== "number" || now - ts > 6e4) throw new ProtocolError("expired", "Session request too old.");
	if (ts > now + 3e4) throw new ProtocolError("future");
	const m2 = hs.writeMessage2(te(JSON.stringify({
		v: 1,
		ts: now
	})));
	const r = hs.result();
	return {
		envelope: concat(header(EnvelopeKind.SessionResp, sid), m2),
		session: new Session({
			role: "responder",
			sessionId: sid,
			...r,
			peerStatic: r.remoteStatic,
			now
		})
	};
}
//#endregion
//#region protocol/dist/sealed.js
/** Max age of a sealed non-command message (matches the relay queue TTL). */
const SEALED_MAX_AGE_MS = 1440 * 6e4;
const HDR_LEN = 50;
const NONCE_LEN = 24;
function deriveKey(ikm, ePub, rPub, sPub) {
	return hkdf(sha256, ikm, sha256(concat(ePub, rPub, sPub)), utf8Encode("sg-sealed-v1"), 32);
}
function sealTo(opts) {
	const e = generateX25519();
	const rPub = opts.recipientDhPub;
	const sPub = opts.sender.dh.publicKey;
	const ikm = concat(dh(e.secretKey, rPub), dh(opts.sender.dh.secretKey, rPub));
	const key = deriveKey(ikm, e.publicKey, rPub, sPub);
	const hdr = header(EnvelopeKind.Sealed, fromBase64Url(keyId(sPub)), fromBase64Url(keyId(rPub)), e.publicKey);
	const nonce = randomBytes(NONCE_LEN);
	const ct = xchacha20poly1305(key, nonce, hdr).encrypt(encodeMessage(opts.message));
	wipe(ikm, key, e.secretKey);
	return concat(hdr, nonce, ct);
}
/** Sender key id (base64url) of a sealed envelope, without decrypting. */
function sealedSenderKeyId(envelope) {
	try {
		if (peekEnvelope(envelope).kind !== EnvelopeKind.Sealed || envelope.length < 90) return null;
	} catch {
		return null;
	}
	return toBase64Url(envelope.subarray(2, 10));
}
/**
* Open a sealed envelope. `resolveSender` maps a sender key id to that paired device's X25519
* public key (or null when unknown or revoked).
*/
function openSealed(opts) {
	const env = opts.envelope;
	const sender = sealedSenderKeyId(env);
	if (!sender) throw new ProtocolError("invalid", "Not a sealed envelope.");
	const rPub = opts.recipient.dh.publicKey;
	if (toBase64Url(env.subarray(10, 18)) !== keyId(rPub)) throw new ProtocolError("wrong_session", "Sealed for another device.");
	const sPub = opts.resolveSender(sender);
	if (!sPub) throw new ProtocolError("unknown_sender", "Unknown or revoked sender.");
	const hdr = env.subarray(0, HDR_LEN);
	const ePub = env.subarray(18, HDR_LEN);
	const nonce = env.subarray(HDR_LEN, 74);
	let ikm;
	try {
		ikm = concat(dh(opts.recipient.dh.secretKey, ePub), dh(opts.recipient.dh.secretKey, sPub));
	} catch {
		throw new ProtocolError("tampered", "Bad ephemeral key.");
	}
	const key = deriveKey(ikm, ePub, rPub, sPub);
	let padded;
	try {
		padded = xchacha20poly1305(key, nonce, hdr).decrypt(env.subarray(74));
	} catch {
		throw new ProtocolError("tampered", "Sealed envelope failed authentication.");
	} finally {
		wipe(ikm, key);
	}
	const message = decodeMessage(padded);
	checkFreshness(message, {
		...opts,
		maxAgeMs: opts.maxAgeMs ?? 864e5
	});
	return {
		message,
		senderDhPub: sPub
	};
}
//#endregion
//#region @noble/hashes/legacy.js
/**

SHA1 (RFC 3174), MD5 (RFC 1321), and RIPEMD160 legacy, weak hash functions.
RFC 2286 only covers HMAC-RIPEMD160 wrapper material and test vectors,
not the base RIPEMD-160 compression spec.
Don't use them in a new protocol. What "weak" means:

- Collisions can be made with 2^18 effort in MD5, 2^60 in SHA1, 2^80 in RIPEMD160.
- No practical pre-image attacks (only theoretical, 2^123.4)
- HMAC seems kinda ok: https://www.rfc-editor.org/rfc/rfc6151
* @module
*/
/** Initial SHA-1 state from RFC 3174 §6.1. */
const SHA1_IV = /* @__PURE__ */ Uint32Array.from([
	1732584193,
	4023233417,
	2562383102,
	271733878,
	3285377520
]);
const SHA1_W = /* @__PURE__ */ new Uint32Array(80);
/** Internal SHA1 legacy hash class. */
var _SHA1 = class extends HashMD {
	A = SHA1_IV[0] | 0;
	B = SHA1_IV[1] | 0;
	C = SHA1_IV[2] | 0;
	D = SHA1_IV[3] | 0;
	E = SHA1_IV[4] | 0;
	constructor() {
		super(64, 20, 8, false);
	}
	get() {
		const { A, B, C, D, E } = this;
		return [
			A,
			B,
			C,
			D,
			E
		];
	}
	set(A, B, C, D, E) {
		this.A = A | 0;
		this.B = B | 0;
		this.C = C | 0;
		this.D = D | 0;
		this.E = E | 0;
	}
	_cloneInto(to) {
		(to ||= new this.constructor()).set(...this.get());
		return this._cloneIntoMeta(to);
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) SHA1_W[i] = view.getUint32(offset, false);
		for (let i = 16; i < 80; i++) SHA1_W[i] = rotl$1(SHA1_W[i - 3] ^ SHA1_W[i - 8] ^ SHA1_W[i - 14] ^ SHA1_W[i - 16], 1);
		let { A, B, C, D, E } = this;
		for (let i = 0; i < 80; i++) {
			let F, K;
			if (i < 20) {
				F = Chi(B, C, D);
				K = 1518500249;
			} else if (i < 40) {
				F = B ^ C ^ D;
				K = 1859775393;
			} else if (i < 60) {
				F = Maj(B, C, D);
				K = 2400959708;
			} else {
				F = B ^ C ^ D;
				K = 3395469782;
			}
			const T = rotl$1(A, 5) + F + E + K + SHA1_W[i] | 0;
			E = D;
			D = C;
			C = rotl$1(B, 30);
			B = A;
			A = T;
		}
		A = A + this.A | 0;
		B = B + this.B | 0;
		C = C + this.C | 0;
		D = D + this.D | 0;
		E = E + this.E | 0;
		this.set(A, B, C, D, E);
	}
	roundClean() {
		clean$1(SHA1_W);
	}
	destroy() {
		this.destroyed = true;
		this.set(0, 0, 0, 0, 0);
		clean$1(this.buffer);
	}
};
//#endregion
//#region protocol/dist/totp.js
const HASHES = {
	SHA1: /* @__PURE__ */ createHasher(() => new _SHA1()),
	SHA256: sha256,
	SHA512: sha512
};
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** RFC 4648 base32: tolerates spaces, hyphens, lower case and = padding; throws on bad chars. */
function base32Decode(input) {
	const clean = String(input || "").toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
	if (!clean) throw new Error("Empty 2FA secret.");
	let bits = 0;
	let value = 0;
	const out = [];
	for (const ch of clean) {
		const idx = B32.indexOf(ch);
		if (idx === -1) throw new Error("Invalid character in 2FA secret (must be base32).");
		value = (value << 5 | idx) & 65535;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			out.push(value >>> bits & 255);
		}
	}
	return Uint8Array.from(out);
}
function base32Encode(bytes) {
	let out = "";
	let bits = 0;
	let value = 0;
	for (const b of bytes) {
		value = (value << 8 | b) & 65535;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += B32[value >>> bits & 31];
		}
	}
	if (bits > 0) out += B32[value << 5 - bits & 31];
	return out;
}
function checkOpts(o) {
	const algorithm = o.algorithm ?? "SHA1";
	const digits = o.digits ?? 6;
	const period = o.period ?? 30;
	if (!(algorithm in HASHES)) throw new Error("Unsupported TOTP algorithm.");
	if (digits !== 6 && digits !== 8) throw new Error("TOTP digits must be 6 or 8.");
	if (!Number.isInteger(period) || period < 1 || period > 3600) throw new Error("Bad TOTP period.");
	return {
		algorithm,
		digits,
		period
	};
}
/** RFC 4226 HOTP with a raw key. */
function hotp(key, counter, opts = {}) {
	const { algorithm, digits } = checkOpts(opts);
	const mac = hmac(HASHES[algorithm], key, u64be(counter));
	const offset = mac[mac.length - 1] & 15;
	const bin = (mac[offset] & 127) << 24 | mac[offset + 1] << 16 | mac[offset + 2] << 8 | mac[offset + 3];
	return String(bin % 10 ** digits).padStart(digits, "0");
}
/** RFC 6238 TOTP with a raw key. */
function totpRaw(key, timestampMs, opts = {}) {
	const { period } = checkOpts(opts);
	return hotp(key, Math.floor(timestampMs / 1e3 / period), opts);
}
/** TOTP from a base32 seed (what authenticator apps store). */
function totp(secretBase32, timestampMs = Date.now(), opts = {}) {
	return totpRaw(base32Decode(secretBase32), timestampMs, opts);
}
function totpToken(secretBase32, opts = {}) {
	const { period } = checkOpts(opts);
	const now = opts.timestampMs ?? Date.now();
	return {
		token: totp(secretBase32, now, opts),
		period,
		secondsRemaining: period - Math.floor(now / 1e3 % period)
	};
}
function pctDecode(s) {
	try {
		return decodeURIComponent(s.replace(/\+/g, "%20"));
	} catch {
		throw new Error("Bad percent encoding in otpauth URI.");
	}
}
/**
* Parses otpauth://totp/Label?secret=...&issuer=...&algorithm=...&digits=...&period=...
* Written without URL/URLSearchParams (incomplete in React Native). HOTP is refused.
*/
function parseOtpauthUri(uri) {
	if (typeof uri !== "string" || uri.length > 2048) throw new Error("Not an otpauth URI.");
	const m = /^otpauth:\/\/([A-Za-z]+)\/([^?#]*)(?:\?([^#]*))?(?:#.*)?$/.exec(uri.trim());
	if (!m) throw new Error("Not an otpauth URI.");
	const type = m[1].toLowerCase();
	if (type === "hotp") throw new Error("Counter based (HOTP) codes are not supported.");
	if (type !== "totp") throw new Error("Unknown OTP type.");
	const label = pctDecode(m[2]);
	const params = {};
	for (const pair of (m[3] ?? "").split("&")) {
		if (!pair) continue;
		const eq = pair.indexOf("=");
		const k = pctDecode(eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
		const val = eq === -1 ? "" : pctDecode(pair.slice(eq + 1));
		if (!(k in params)) params[k] = val;
	}
	if (!params.secret) throw new Error("otpauth URI has no secret.");
	const secret = base32Encode(base32Decode(params.secret));
	if (secret.length < 16) throw new Error("2FA secret is too short.");
	const algorithm = (params.algorithm ?? "SHA1").toUpperCase().replace("-", "");
	if (!(algorithm in HASHES)) throw new Error("Unsupported algorithm.");
	const digits = Number(params.digits ?? 6);
	if (digits !== 6 && digits !== 8) throw new Error("Unsupported digits.");
	const period = Number(params.period ?? 30);
	if (!Number.isInteger(period) || period < 1 || period > 3600) throw new Error("Unsupported period.");
	const colon = label.indexOf(":");
	const labelIssuer = colon === -1 ? void 0 : label.slice(0, colon).trim();
	const account = (colon === -1 ? label : label.slice(colon + 1)).trim() || void 0;
	const issuer = params.issuer?.trim() || labelIssuer || void 0;
	const out = {
		type: "totp",
		label,
		secret,
		algorithm,
		digits,
		period
	};
	if (issuer) out.issuer = issuer;
	if (account) out.account = account;
	return out;
}
//#endregion
//#region protocol/dist/relayWire.js
const RELAY_PROTOCOL_VERSION = 1;
/** Max size of one relay frame (bytes of JSON text). */
const MAX_RELAY_FRAME_BYTES = 64 * 1024;
const Mailbox = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(MAILBOX_ID_RE));
const B64 = (min, max) => /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Za-z0-9_-]*$/), /* @__PURE__ */ minLength(min), /* @__PURE__ */ maxLength(max));
const Env = B64(4, 56e3);
const ClientId = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Za-z0-9_-]{1,40}$/));
const Ticket = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Za-z0-9_-]{11}$/));
const PUSH_KINDS = [
	"none",
	"alert",
	"approval",
	"security"
];
const ClientFrameSchema = /* @__PURE__ */ variant("t", [
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("auth"),
		mailbox: Mailbox,
		pub: B64(43, 43),
		sig: B64(86, 86),
		role: /* @__PURE__ */ picklist(["pc", "phone"]),
		/** Entitlement token from api.softglaze.com (required when the relay is configured for it). */
		entitlement: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(4096)))
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("send"),
		id: ClientId,
		to: Mailbox,
		env: Env,
		push: /* @__PURE__ */ optional(/* @__PURE__ */ picklist(PUSH_KINDS))
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("pair_open"),
		ticket: Ticket,
		ttlMs: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ integer(), /* @__PURE__ */ minValue(1e3), /* @__PURE__ */ maxValue(5 * 6e4))
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("pair_close"),
		ticket: Ticket
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("pair_send"),
		id: ClientId,
		ticket: Ticket,
		env: Env
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("pair_reply"),
		id: ClientId,
		to: Mailbox,
		ticket: Ticket,
		env: Env
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("link"),
		peer: Mailbox
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("unlink"),
		peer: Mailbox
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("presence_sub"),
		peers: /* @__PURE__ */ pipe(/* @__PURE__ */ array(Mailbox), /* @__PURE__ */ maxLength(50))
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("push_register"),
		platform: /* @__PURE__ */ picklist(["apns", "fcm"]),
		token: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Za-z0-9_:.-]{16,4096}$/)),
		sandbox: /* @__PURE__ */ optional(/* @__PURE__ */ boolean())
	}),
	/* @__PURE__ */ object({ t: /* @__PURE__ */ literal("push_unregister") }),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("got"),
		qid: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(40))
	}),
	/* @__PURE__ */ object({
		t: /* @__PURE__ */ literal("bye"),
		reason: /* @__PURE__ */ picklist(["sleep", "quit"])
	}),
	/* @__PURE__ */ object({ t: /* @__PURE__ */ literal("ping") })
]);
function parseClientFrame(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	const r = /* @__PURE__ */ safeParse(ClientFrameSchema, raw);
	return r.success ? r.output : null;
}
/** Bytes the device signs to prove it owns its mailbox. */
function authPayload(nonce, mailbox, role, relayHost) {
	return utf8Encode(`sg-relay-auth-v1\n${relayHost}\n${nonce}\n${mailbox}\n${role}`);
}
function buildAuthFrame(identity, nonce, role, relayHost, entitlement) {
	const sig = sign(authPayload(nonce, identity.mailboxId, role, relayHost), identity.sign.secretKey);
	const frame = {
		t: "auth",
		mailbox: identity.mailboxId,
		pub: toBase64Url(identity.sign.publicKey),
		sig: toBase64Url(sig),
		role
	};
	if (entitlement) frame.entitlement = entitlement;
	return frame;
}
//#endregion
//#region protocol/dist/lease.js
const LEASE_TTL_MS = 9e4;
const LEASE_RENEW_EVERY_MS = 3e4;
var LeaseTable = class {
	now;
	ttlMs;
	leases = /* @__PURE__ */ new Map();
	/** Highest epoch ever issued per profile, so epochs never go back after a release. */
	epochs = /* @__PURE__ */ new Map();
	constructor(now = Date.now, ttlMs = LEASE_TTL_MS) {
		this.now = now;
		this.ttlMs = ttlMs;
	}
	get(profileId) {
		const l = this.leases.get(profileId);
		if (!l) return null;
		if (l.expiresAt <= this.now()) {
			this.leases.delete(profileId);
			return null;
		}
		return { ...l };
	}
	issue(profileId, holder) {
		const epoch = (this.epochs.get(profileId) ?? 0) + 1;
		this.epochs.set(profileId, epoch);
		const lease = {
			profileId,
			holderDeviceId: holder,
			epoch,
			expiresAt: this.now() + this.ttlMs
		};
		this.leases.set(profileId, lease);
		return { ...lease };
	}
	acquire(profileId, deviceId) {
		const cur = this.get(profileId);
		if (cur && cur.holderDeviceId !== deviceId) return {
			ok: false,
			reason: "in_use",
			lease: cur
		};
		if (cur) return this.renew(profileId, deviceId, cur.epoch);
		return {
			ok: true,
			lease: this.issue(profileId, deviceId)
		};
	}
	renew(profileId, deviceId, epoch) {
		const cur = this.get(profileId);
		if (!cur || cur.holderDeviceId !== deviceId) return {
			ok: false,
			reason: "not_holder",
			...cur ? { lease: cur } : {}
		};
		if (cur.epoch !== epoch) return {
			ok: false,
			reason: "stale_epoch",
			lease: cur
		};
		const l = this.leases.get(profileId);
		l.expiresAt = this.now() + this.ttlMs;
		return {
			ok: true,
			lease: { ...l }
		};
	}
	release(profileId, deviceId, epoch) {
		const cur = this.get(profileId);
		if (!cur || cur.holderDeviceId !== deviceId) return {
			ok: false,
			reason: "not_holder"
		};
		if (cur.epoch !== epoch) return {
			ok: false,
			reason: "stale_epoch",
			lease: cur
		};
		this.leases.delete(profileId);
		return {
			ok: true,
			lease: cur
		};
	}
	/** Take over from another holder: raises the epoch; the old holder must save a conflict snapshot and close. */
	takeover(profileId, deviceId) {
		const cur = this.get(profileId);
		const lease = this.issue(profileId, deviceId);
		return cur && cur.holderDeviceId !== deviceId ? {
			ok: true,
			lease,
			previousHolder: cur.holderDeviceId
		} : {
			ok: true,
			lease
		};
	}
	/** A write tagged with `epoch` is accepted only from the current, unexpired holder epoch. */
	acceptsWrite(profileId, deviceId, epoch) {
		const cur = this.get(profileId);
		return !!cur && cur.holderDeviceId === deviceId && cur.epoch === epoch;
	}
};
//#endregion
//#region protocol/dist/sync/keys.js
/** Blob ids, space ids and profile ids on the wire. */
const SYNC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** What is stored per profile. `index` (the list of synced profiles) and key wraps are per space. */
const SYNC_PARTS = [
	"meta",
	"cookies",
	"tabs",
	"bookmarks",
	"history",
	"lease"
];
/** Space id = base64url(SHA-256("sg-sync-space-v1" || PC Ed25519 public key)[0..16]). The relay checks it. */
function syncSpaceId(ownerSignPub) {
	if (ownerSignPub.length !== 32) throw new Error("Ed25519 public key must be 32 bytes.");
	return toBase64Url(sha256(concat(utf8Encode("sg-sync-space-v1"), ownerSignPub)).subarray(0, 16));
}
function generateSyncKey(epoch = 1, nameKey) {
	if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("Bad key epoch.");
	return {
		epoch,
		key: randomBytes(32),
		nameKey: nameKey ? Uint8Array.from(nameKey) : randomBytes(32)
	};
}
/** Opaque blob name for one part of one profile: the relay cannot tell profiles or parts apart. */
function syncBlobId(nameKey, profileId, part) {
	return toBase64Url(hmac(sha256, nameKey, utf8Encode(`sg-sync-name-v1\n${profileId}\n${part}`)).subarray(0, 16));
}
/** Blob id of the space index (list of synced profiles). */
function syncIndexBlobId(nameKey) {
	return syncBlobId(nameKey, "*", "index");
}
/** Blob id of a member's key wrap. Derived from its X25519 key so the member finds it without the key. */
function keyWrapBlobId(recipientDhPub) {
	return `kw-${keyId(recipientDhPub)}`;
}
const WRAP_MAGIC = utf8Encode("SGK1");
const WRAP_HDR = 52;
const WRAP_NONCE = 24;
function wrapKey(ikm, ePub, rPub, sPub) {
	return hkdf(sha256, ikm, sha256(concat(ePub, rPub, sPub)), utf8Encode("sg-sync-wrap-v1"), 32);
}
function wrapSyncKey(opts) {
	const e = generateX25519();
	const rPub = opts.recipientDhPub;
	const sPub = opts.sender.dh.publicKey;
	const ikm = concat(dh(e.secretKey, rPub), dh(opts.sender.dh.secretKey, rPub));
	const k = wrapKey(ikm, e.publicKey, rPub, sPub);
	const hdr = concat(WRAP_MAGIC, fromBase64Url(keyId(sPub)), fromBase64Url(keyId(rPub)), e.publicKey);
	const body = utf8Encode(JSON.stringify({
		v: 1,
		spaceId: opts.spaceId,
		epoch: opts.key.epoch,
		key: toBase64Url(opts.key.key),
		nameKey: toBase64Url(opts.key.nameKey),
		issuedAt: opts.now ?? Date.now()
	}));
	const nonce = randomBytes(WRAP_NONCE);
	const ct = xchacha20poly1305(k, nonce, concat(hdr, utf8Encode(opts.spaceId))).encrypt(body);
	wipe(ikm, k, e.secretKey, body);
	return concat(hdr, nonce, ct);
}
/** Sender key id of a wrap (base64url), without decrypting. */
function keyWrapSender(envelope) {
	if (envelope.length < 92 || !equalBytes(envelope.subarray(0, 4), WRAP_MAGIC)) return null;
	return toBase64Url(envelope.subarray(4, 12));
}
function unwrapSyncKey(opts) {
	const env = opts.envelope;
	const sender = keyWrapSender(env);
	if (!sender) throw new ProtocolError("invalid", "Not a key wrap.");
	const rPub = opts.recipient.dh.publicKey;
	if (toBase64Url(env.subarray(12, 20)) !== keyId(rPub)) throw new ProtocolError("wrong_session", "Key wrap for another device.");
	const sPub = opts.resolveSender(sender);
	if (!sPub) throw new ProtocolError("unknown_sender", "Key wrap from an unknown device.");
	const hdr = env.subarray(0, WRAP_HDR);
	const ePub = env.subarray(20, WRAP_HDR);
	let ikm;
	try {
		ikm = concat(dh(opts.recipient.dh.secretKey, ePub), dh(opts.recipient.dh.secretKey, sPub));
	} catch {
		throw new ProtocolError("tampered", "Bad ephemeral key.");
	}
	const k = wrapKey(ikm, ePub, rPub, sPub);
	let plain;
	try {
		plain = xchacha20poly1305(k, env.subarray(WRAP_HDR, 76), concat(hdr, utf8Encode(opts.spaceId))).decrypt(env.subarray(76));
	} catch {
		throw new ProtocolError("tampered", "Key wrap failed authentication.");
	} finally {
		wipe(ikm, k);
	}
	let o;
	try {
		o = JSON.parse(utf8Decode(plain));
	} catch {
		throw new ProtocolError("invalid", "Key wrap body is not JSON.");
	} finally {
		wipe(plain);
	}
	if (o.v !== 1 || o.spaceId !== opts.spaceId || typeof o.epoch !== "number" || !Number.isSafeInteger(o.epoch) || o.epoch < 1) throw new ProtocolError("invalid", "Bad key wrap body.");
	const key = fromBase64Url(String(o.key));
	const nameKey = fromBase64Url(String(o.nameKey));
	if (key.length !== 32 || nameKey.length !== 32) throw new ProtocolError("invalid", "Bad key length.");
	return {
		epoch: o.epoch,
		key,
		nameKey,
		issuedAt: typeof o.issuedAt === "number" ? o.issuedAt : 0
	};
}
function keyringLookup(ring, epoch) {
	if (!ring) return null;
	if (ring.current.epoch === epoch) return ring.current;
	return ring.previous.find((k) => k.epoch === epoch) ?? null;
}
/** Add a newer key (an older or equal epoch is ignored). Keeps at most 3 previous epochs. */
function keyringAdd(ring, spaceId, key) {
	if (!ring) return {
		spaceId,
		current: key,
		previous: []
	};
	if (key.epoch <= ring.current.epoch) return ring;
	return {
		spaceId,
		current: key,
		previous: [ring.current, ...ring.previous].slice(0, 3)
	};
}
function exportKeyring(ring) {
	return {
		v: 1,
		spaceId: ring.spaceId,
		keys: [ring.current, ...ring.previous].map((k) => ({
			epoch: k.epoch,
			key: toBase64Url(k.key),
			nameKey: toBase64Url(k.nameKey)
		}))
	};
}
function importKeyring(s) {
	if (!s || s.v !== 1 || !Array.isArray(s.keys) || !s.keys.length) throw new Error("Unknown keyring format.");
	const keys = s.keys.map((k) => ({
		epoch: k.epoch,
		key: fromBase64Url(k.key),
		nameKey: fromBase64Url(k.nameKey)
	}));
	keys.sort((a, b) => b.epoch - a.epoch);
	return {
		spaceId: s.spaceId,
		current: keys[0],
		previous: keys.slice(1)
	};
}
//#endregion
//#region protocol/dist/sync/blob.js
/** Max ciphertext size of one blob (the relay refuses larger bodies). */
const SYNC_MAX_BLOB_BYTES = 2 * 1024 * 1024;
const MAGIC = utf8Encode("SGB1");
const HDR = 8;
const NONCE = 24;
const TAG = 16;
function blobKey(key, spaceId) {
	return hkdf(sha256, key.key, utf8Encode(spaceId), utf8Encode("sg-sync-blob-v1"), 32);
}
function aadFor(hdr, spaceId, blobId, version) {
	return concat(hdr, utf8Encode(`${spaceId}\n${blobId}\n${version}`));
}
/** Padded size: at least 1 KiB, powers of two up to 64 KiB, then 64 KiB steps (hides exact sizes). */
function paddedSize(n) {
	if (n <= 1024) return 1024;
	if (n <= 65536) {
		let s = 1024;
		while (s < n) s *= 2;
		return s;
	}
	return Math.ceil(n / 65536) * 65536;
}
function pad$1(json) {
	const out = new Uint8Array(paddedSize(json.length + 4));
	out.set(u32be(json.length), 0);
	out.set(json, 4);
	return out;
}
function unpad$1(p) {
	if (p.length < 4) throw new ProtocolError("invalid", "Short blob.");
	const n = readU32be(p, 0);
	if (n > p.length - 4) throw new ProtocolError("invalid", "Bad blob padding.");
	return p.subarray(4, 4 + n);
}
function checkVersion(version) {
	if (!Number.isSafeInteger(version) || version < 1) throw new ProtocolError("invalid", "Bad blob version.");
}
function sealBlob(opts) {
	checkVersion(opts.version);
	const hdr = concat(MAGIC, u32be(opts.key.epoch));
	const body = pad$1(utf8Encode(JSON.stringify(opts.payload)));
	if (body.length + HDR + NONCE + TAG > 2097152) throw new ProtocolError("invalid", "Blob too large.");
	const nonce = randomBytes(NONCE);
	return concat(hdr, nonce, xchacha20poly1305(blobKey(opts.key, opts.spaceId), nonce, aadFor(hdr, opts.spaceId, opts.blobId, opts.version)).encrypt(body));
}
/** Key epoch a blob was sealed with, or null when it is not a sync blob. */
function blobEpoch(data) {
	if (data.length < 48 || !equalBytes(data.subarray(0, 4), MAGIC)) return null;
	return readU32be(data, 4);
}
/** Open a blob. `keyFor(epoch)` returns the key of that epoch, or null (then `no_key`: fetch the newer key wrap). */
function openBlob(opts) {
	checkVersion(opts.version);
	const epoch = blobEpoch(opts.data);
	if (epoch == null) throw new ProtocolError("invalid", "Not a sync blob.");
	const key = opts.keyFor(epoch);
	if (!key) throw new ProtocolError("no_key", `No key for epoch ${epoch}.`);
	const hdr = opts.data.subarray(0, HDR);
	let plain;
	try {
		plain = xchacha20poly1305(blobKey(key, opts.spaceId), opts.data.subarray(HDR, 32), aadFor(hdr, opts.spaceId, opts.blobId, opts.version)).decrypt(opts.data.subarray(32));
	} catch {
		throw new ProtocolError("tampered", "Blob failed authentication.");
	}
	try {
		return JSON.parse(utf8Decode(unpad$1(plain)));
	} catch (e) {
		if (e instanceof ProtocolError) throw e;
		throw new ProtocolError("invalid", "Blob body is not JSON.");
	}
}
//#endregion
//#region protocol/dist/sync/auth.js
const SYNC_AUTH_MAX_SKEW_MS = 12e4;
const SYNC_HEADERS = {
	mailbox: "x-sg-mailbox",
	pub: "x-sg-pub",
	ts: "x-sg-ts",
	sig: "x-sg-sig",
	/** New version of a blob (PUT). */
	ver: "x-sg-ver",
	/** Version the writer last saw (PUT, DELETE): compare and swap, 0 = must not exist. */
	prev: "x-sg-prev"
};
function syncBodyHash(body) {
	return toBase64Url(sha256(body ?? /* @__PURE__ */ new Uint8Array(0)));
}
function syncAuthPayload(p) {
	return utf8Encode(`sg-blob-auth-v1\n${p.host}\n${p.method.toUpperCase()}\n${p.path}\n${p.ts}\n${p.bodyHash}`);
}
/** Headers that authenticate one request. `path` includes the query string. */
function signSyncRequest(identity, req) {
	const ts = req.ts ?? Date.now();
	const payload = syncAuthPayload({
		host: req.host,
		method: req.method,
		path: req.path,
		ts,
		bodyHash: syncBodyHash(req.body)
	});
	return {
		[SYNC_HEADERS.mailbox]: identity.mailboxId,
		[SYNC_HEADERS.pub]: toBase64Url(identity.sign.publicKey),
		[SYNC_HEADERS.ts]: String(ts),
		[SYNC_HEADERS.sig]: toBase64Url(sign(payload, identity.sign.secretKey))
	};
}
//#endregion
//#region protocol/dist/sync/types.js
/** Profile settings that sync, one entry per field (newest wins per field). */
const META_FIELDS = [
	"title",
	"folder",
	"notes",
	"tags",
	"startUrls",
	"proxy",
	"region",
	"desktopSite",
	"mobile",
	"origin"
];
const Id = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ regex(/^[A-Za-z0-9_.:-]{1,128}$/));
const StampSchema = /* @__PURE__ */ object({
	at: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0)),
	dev: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(128)),
	lc: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0))
});
const entry = (value) => /* @__PURE__ */ object({
	v: /* @__PURE__ */ nullable(value),
	s: StampSchema
});
const entries = (value, max) => /* @__PURE__ */ pipe(/* @__PURE__ */ record(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(160)), entry(value)), /* @__PURE__ */ check((r) => Object.keys(r).length <= max, "too many entries"));
const Url = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(8192));
const Text = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(2e3));
const MAX_TABS = 500;
const MAX_BOOKMARKS = 5e3;
const MAX_HISTORY = 500;
const MAX_COOKIES = 5e3;
const SCHEMAS = {
	meta: /* @__PURE__ */ object({
		v: /* @__PURE__ */ literal(1),
		profileId: Id,
		fields: entries(/* @__PURE__ */ unknown(), 64)
	}),
	tabs: /* @__PURE__ */ object({
		v: /* @__PURE__ */ literal(1),
		profileId: Id,
		items: entries(/* @__PURE__ */ object({
			url: Url,
			title: Text,
			order: /* @__PURE__ */ number()
		}), 500 * 2),
		active: entry(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(160)))
	}),
	bookmarks: /* @__PURE__ */ object({
		v: /* @__PURE__ */ literal(1),
		profileId: Id,
		items: entries(/* @__PURE__ */ object({
			url: Url,
			title: Text,
			createdAt: /* @__PURE__ */ number()
		}), MAX_BOOKMARKS * 2)
	}),
	history: /* @__PURE__ */ object({
		v: /* @__PURE__ */ literal(1),
		profileId: Id,
		items: entries(/* @__PURE__ */ object({
			url: Url,
			title: Text,
			visitedAt: /* @__PURE__ */ number()
		}), 500 * 4)
	}),
	cookies: /* @__PURE__ */ object({
		v: /* @__PURE__ */ literal(1),
		profileId: Id,
		leaseEpoch: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0)),
		by: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(128)),
		at: /* @__PURE__ */ number(),
		cookies: /* @__PURE__ */ pipe(/* @__PURE__ */ array(/* @__PURE__ */ object({
			name: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(4096)),
			value: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(8192)),
			domain: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(255)),
			path: /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(1024)),
			expires: /* @__PURE__ */ nullable(/* @__PURE__ */ number()),
			secure: /* @__PURE__ */ boolean(),
			httpOnly: /* @__PURE__ */ boolean(),
			sameSite: /* @__PURE__ */ picklist([
				"lax",
				"strict",
				"none",
				"unspecified"
			]),
			hostOnly: /* @__PURE__ */ boolean()
		})), /* @__PURE__ */ maxLength(MAX_COOKIES))
	}),
	lease: /* @__PURE__ */ object({
		v: /* @__PURE__ */ literal(1),
		profileId: Id,
		holder: /* @__PURE__ */ nullable(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(128))),
		holderName: /* @__PURE__ */ nullable(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ maxLength(200))),
		epoch: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0)),
		since: /* @__PURE__ */ nullable(/* @__PURE__ */ number()),
		expiresAt: /* @__PURE__ */ nullable(/* @__PURE__ */ number()),
		jar: /* @__PURE__ */ nullable(/* @__PURE__ */ object({
			epoch: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger()),
			version: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger())
		}))
	}),
	index: /* @__PURE__ */ object({
		v: /* @__PURE__ */ literal(1),
		profiles: entries(/* @__PURE__ */ object({ origin: /* @__PURE__ */ picklist(["pc", "phone"]) }), 5e3)
	})
};
var SyncPayloadError = class extends Error {
	part;
	constructor(part, issues) {
		super(`Bad ${part} payload: ${issues}`);
		this.part = part;
		this.name = "SyncPayloadError";
	}
};
/** Validate a decrypted payload (a paired but buggy or hostile device must not break the app). */
function checkPayload(part, input) {
	const r = /* @__PURE__ */ safeParse(SCHEMAS[part], input);
	if (!r.success) throw new SyncPayloadError(part, /* @__PURE__ */ summarize(r.issues));
	return r.output;
}
//#endregion
//#region protocol/dist/sync/merge.js
function compareStamp(a, b) {
	if (a.at !== b.at) return a.at - b.at;
	if (a.lc !== b.lc) return a.lc - b.lc;
	return a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0;
}
function sameStamp(a, b) {
	return !!a && !!b && a.at === b.at && a.lc === b.lc && a.dev === b.dev;
}
/** Stable JSON (sorted keys) for value comparison. */
function stableJson(x) {
	if (x === void 0) return "null";
	if (x === null || typeof x !== "object") return JSON.stringify(x);
	if (Array.isArray(x)) return `[${x.map(stableJson).join(",")}]`;
	const o = x;
	return `{${Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}
function sameValue(a, b) {
	return stableJson(a) === stableJson(b);
}
/**
* Three way merge of entry maps. `base` is the last state both sides agreed on (the device's
* shadow), `local` the device's current entries (already stamped), `remote` what the relay holds.
*/
function mergeEntries(base, local, remote) {
	const merged = {};
	const conflicts = [];
	const changedLocally = [];
	let uploadNeeded = false;
	const ids = /* @__PURE__ */ new Set([...Object.keys(local), ...Object.keys(remote)]);
	for (const id of ids) {
		const l = local[id];
		const r = remote[id];
		const b = base[id];
		let win;
		if (!l) win = r;
		else if (!r) win = l;
		else {
			win = compareStamp(l.s, r.s) >= 0 ? l : r;
			const localEdited = !sameStamp(l.s, b?.s);
			const remoteEdited = !sameStamp(r.s, b?.s);
			if (localEdited && remoteEdited && !sameStamp(l.s, r.s) && !sameValue(l.v, r.v) && l.v !== null && r.v !== null) conflicts.push({
				id,
				kept: win,
				other: win === l ? r : l
			});
		}
		merged[id] = win;
		if (!r || !sameStamp(r.s, win.s)) uploadNeeded = true;
		if (!l ? win.v !== null : !sameValue(l.v, win.v)) changedLocally.push(id);
	}
	return {
		merged,
		conflicts,
		uploadNeeded,
		changedLocally
	};
}
/** Merge for single values (the active tab, a meta field): newest wins, no conflict report. */
function newestEntry(a, b) {
	if (!a) return b;
	if (!b) return a;
	return compareStamp(a.s, b.s) >= 0 ? a : b;
}
/** Highest Lamport counter in some maps (the device then counts on from max + 1). */
function maxLamport(...maps) {
	let m = 0;
	for (const map of maps) if (map) {
		for (const e of Object.values(map)) if (e.s.lc > m) m = e.s.lc;
	}
	return m;
}
/**
* Turn the device's current plain values into stamped entries: unchanged values keep the base
* stamp, changed or new values get `stamp()`, values missing locally become deletions.
*/
function stampLocal(base, values, stamp) {
	const out = {};
	for (const [id, value] of Object.entries(values)) {
		const b = base[id];
		out[id] = b && b.v !== null && sameValue(b.v, value) ? b : {
			v: value,
			s: stamp()
		};
	}
	for (const [id, b] of Object.entries(base)) {
		if (id in values) continue;
		out[id] = b.v === null ? b : {
			v: null,
			s: stamp()
		};
	}
	return out;
}
/** Plain values of an entry map (deleted entries left out). */
function valuesOf(map) {
	const out = {};
	for (const [id, e] of Object.entries(map)) if (e.v !== null) out[id] = e.v;
	return out;
}
/** Drop deletion markers older than `maxAgeMs` (devices offline longer than that resync fully). */
function pruneTombstones(map, now, maxAgeMs = 30 * 864e5) {
	const out = {};
	for (const [id, e] of Object.entries(map)) if (e.v !== null || now - e.s.at < maxAgeMs) out[id] = e;
	return out;
}
/** Keep only the newest `max` live entries by `order(value)` (history cap). Older ones are dropped, not deleted. */
function capEntries(map, max, order) {
	const live = Object.entries(map).filter(([, e]) => e.v !== null);
	if (live.length <= max) return map;
	const keep = new Set(live.sort((a, b) => order(b[1].v) - order(a[1].v)).slice(0, max).map(([id]) => id));
	const out = {};
	for (const [id, e] of Object.entries(map)) if (e.v === null || keep.has(id)) out[id] = e;
	return out;
}
/** "Keep both": the losing copies come back under new ids, stamped now. */
function keepBoth(map, conflicts, stamp) {
	const out = { ...map };
	for (const c of conflicts) {
		if (c.other.v === null) continue;
		let n = 2;
		let id = `${c.id}~${n}`;
		while (out[id]) id = `${c.id}~${++n}`;
		out[id] = {
			v: c.other.v,
			s: stamp()
		};
	}
	return out;
}
//#endregion
//#region protocol/dist/sync/lease.js
function emptyLease(profileId) {
	return {
		v: 1,
		profileId,
		holder: null,
		holderName: null,
		epoch: 0,
		since: null,
		expiresAt: null,
		jar: null
	};
}
/** The live holder, or null when free or expired. */
function leaseHolder(rec, now) {
	if (!rec || !rec.holder || rec.expiresAt == null || rec.expiresAt <= now) return null;
	return {
		id: rec.holder,
		name: rec.holderName ?? rec.holder,
		since: rec.since ?? now,
		expiresAt: rec.expiresAt
	};
}
function leaseAcquire(rec, dev, name, now, ttlMs = LEASE_TTL_MS) {
	const h = leaseHolder(rec, now);
	if (h && h.id !== dev) return {
		ok: false,
		reason: "in_use",
		holder: h
	};
	if (h) return {
		ok: true,
		rec: {
			...rec,
			expiresAt: now + ttlMs
		}
	};
	return {
		ok: true,
		rec: {
			...rec,
			holder: dev,
			holderName: name,
			epoch: rec.epoch + 1,
			since: now,
			expiresAt: now + ttlMs
		}
	};
}
function leaseRenew(rec, dev, epoch, now, ttlMs = LEASE_TTL_MS) {
	const h = leaseHolder(rec, now);
	if (rec.holder === dev && rec.epoch === epoch && (!h || h.id === dev)) return {
		ok: true,
		rec: {
			...rec,
			expiresAt: now + ttlMs
		}
	};
	return {
		ok: false,
		reason: "lost",
		holder: h
	};
}
/** Release, optionally pointing readers at the cookie jar the holder just wrote. */
function leaseRelease(rec, dev, epoch, now, jar) {
	if (rec.holder !== dev || rec.epoch !== epoch) return {
		ok: false,
		reason: "lost",
		holder: leaseHolder(rec, now)
	};
	return {
		ok: true,
		rec: {
			...rec,
			holder: null,
			holderName: null,
			since: null,
			expiresAt: null,
			jar: jar ?? rec.jar
		}
	};
}
/** A checkpoint while holding: renew and point readers at a newer jar (phones can be killed without a release). */
function leaseCheckpoint(rec, dev, epoch, now, jar, ttlMs = LEASE_TTL_MS) {
	const r = leaseRenew(rec, dev, epoch, now, ttlMs);
	return r.ok ? {
		ok: true,
		rec: {
			...r.rec,
			jar
		}
	} : r;
}
/** "Profile is open on OFFICE-PC since 10:42. Take over?" Raises the epoch; the old holder loses on its next renew. */
function leaseTakeover(rec, dev, name, now, ttlMs = LEASE_TTL_MS) {
	const h = leaseHolder(rec, now);
	const next = {
		...rec,
		holder: dev,
		holderName: name,
		epoch: rec.epoch + 1,
		since: now,
		expiresAt: now + ttlMs
	};
	return h && h.id !== dev ? {
		ok: true,
		rec: next,
		previous: h
	} : {
		ok: true,
		rec: next
	};
}
/** A cookie jar is applied only when the lease record points at exactly that jar (fences late writes of a lost holder). */
function jarAccepted(rec, jar, version) {
	return !!rec?.jar && rec.jar.epoch === jar.leaseEpoch && rec.jar.version === version;
}
//#endregion
//#region protocol/dist/sync/client.js
var SyncHttpError = class extends Error {
	code;
	status;
	constructor(code, status, message) {
		super(message ?? `${code} (${status})`);
		this.code = code;
		this.status = status;
		this.name = "SyncHttpError";
	}
};
function codeFor(status) {
	if (status === 401) return "unauthorized";
	if (status === 403) return "forbidden";
	if (status === 404) return "not_found";
	if (status === 409) return "conflict";
	if (status === 413) return "too_large";
	if (status === 507) return "quota";
	if (status === 429) return "rate";
	if (status >= 400 && status < 500) return "bad_request";
	return "server";
}
var SyncRelayClient = class SyncRelayClient {
	base;
	host;
	identity;
	http;
	now;
	/**
	* `relayUrl` may be the WebSocket URL from pairing (wss://relay.softglaze.com/v1): it becomes
	* https://relay.softglaze.com. `host` is the name signed in requests (the relay's RELAY_PUBLIC_HOST).
	*/
	constructor(opts) {
		const m = /^(wss?|https?):\/\/([^/?#]+)/i.exec(opts.relayUrl);
		if (!m) throw new Error("Bad relay URL.");
		const scheme = m[1].toLowerCase();
		const secure = scheme === "wss" || scheme === "https";
		this.base = `${secure ? "https" : "http"}://${m[2]}`;
		this.host = opts.host ?? m[2].replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
		this.identity = opts.identity;
		this.http = opts.http;
		this.now = opts.now ?? Date.now;
	}
	async call(method, path, body, extra = {}) {
		const headers = {
			...signSyncRequest(this.identity, {
				host: this.host,
				method,
				path,
				body: body ?? null,
				ts: this.now()
			}),
			...extra
		};
		if (body) headers["content-type"] = "application/octet-stream";
		let res;
		try {
			res = await this.http({
				method,
				url: this.base + path,
				headers,
				...body ? { body } : {}
			});
		} catch (e) {
			throw new SyncHttpError("offline", 0, String(e instanceof Error ? e.message : e));
		}
		return res;
	}
	static json(res) {
		return JSON.parse(utf8Decode(res.body));
	}
	static fail(res) {
		let msg;
		try {
			msg = SyncRelayClient.json(res).error ?? void 0;
		} catch {
			msg = void 0;
		}
		throw new SyncHttpError(codeFor(res.status), res.status, msg);
	}
	/** Owner (PC) only: create the space or replace its member list. */
	async setMembers(spaceId, members) {
		const res = await this.call("PUT", `/v1/sync/${spaceId}`, utf8Encode(JSON.stringify({ members })));
		if (res.status !== 200) SyncRelayClient.fail(res);
	}
	async spaceInfo(spaceId) {
		const res = await this.call("GET", `/v1/sync/${spaceId}`);
		if (res.status === 404) return null;
		if (res.status !== 200) SyncRelayClient.fail(res);
		return SyncRelayClient.json(res);
	}
	/** Owner only: delete the space and every blob in it. */
	async deleteSpace(spaceId) {
		const res = await this.call("DELETE", `/v1/sync/${spaceId}`);
		if (res.status !== 200 && res.status !== 404) SyncRelayClient.fail(res);
	}
	async list(spaceId, since = 0) {
		const res = await this.call("GET", `/v1/sync/${spaceId}/blobs?since=${since}`);
		if (res.status !== 200) SyncRelayClient.fail(res);
		return SyncRelayClient.json(res);
	}
	async get(spaceId, blobId) {
		const res = await this.call("GET", `/v1/sync/${spaceId}/blobs/${blobId}`);
		if (res.status === 404) return null;
		if (res.status !== 200) SyncRelayClient.fail(res);
		const ver = Number(res.headers[SYNC_HEADERS.ver]);
		if (!Number.isSafeInteger(ver) || ver < 1) throw new SyncHttpError("server", res.status, "Missing version.");
		return {
			ver,
			data: res.body
		};
	}
	/** Compare and swap: succeeds only when the stored version is still `prev` (0 = must not exist). */
	async put(spaceId, blobId, ver, prev, data) {
		const res = await this.call("PUT", `/v1/sync/${spaceId}/blobs/${blobId}`, data, {
			[SYNC_HEADERS.ver]: String(ver),
			[SYNC_HEADERS.prev]: String(prev)
		});
		if (res.status === 409) return {
			ok: false,
			conflict: true,
			ver: SyncRelayClient.json(res).ver
		};
		if (res.status !== 200) SyncRelayClient.fail(res);
		return {
			ok: true,
			seq: SyncRelayClient.json(res).seq
		};
	}
	async del(spaceId, blobId, prev) {
		const res = await this.call("DELETE", `/v1/sync/${spaceId}/blobs/${blobId}`, void 0, prev != null ? { [SYNC_HEADERS.prev]: String(prev) } : {});
		if (res.status === 409) return {
			ok: false,
			conflict: true,
			ver: SyncRelayClient.json(res).ver
		};
		if (res.status === 404) return {
			ok: true,
			seq: 0
		};
		if (res.status !== 200) SyncRelayClient.fail(res);
		return {
			ok: true,
			seq: SyncRelayClient.json(res).seq
		};
	}
};
//#endregion
//#region protocol/dist/sync/engine.js
const DATA_PARTS = [
	"meta",
	"tabs",
	"bookmarks",
	"history"
];
function emptySyncState() {
	return {
		v: 1,
		lc: 0,
		seq: 0,
		clockOffset: 0,
		heads: {},
		seen: {},
		shadows: {},
		index: {},
		indexPending: {},
		profiles: {},
		conflicts: {},
		leases: {},
		jarApplied: {},
		pausedAll: false
	};
}
var SyncError = class extends Error {
	code;
	constructor(code, message) {
		super(message ?? code);
		this.code = code;
		this.name = "SyncError";
	}
};
function toSyncError(e) {
	if (e instanceof SyncError) return e;
	if (e instanceof SyncHttpError) {
		if (e.code === "offline") return new SyncError("offline", e.message);
		if (e.code === "forbidden" || e.code === "unauthorized") return new SyncError("not_member", e.message);
		if (e.code === "quota") return new SyncError("quota", e.message);
		if (e.code === "too_large") return new SyncError("too_large", e.message);
		if (e.code === "rate") return new SyncError("rate", e.message);
		return new SyncError("error", e.message);
	}
	if (e instanceof ProtocolError) {
		if (e.code === "no_key") return new SyncError("waiting_for_pc", e.message);
		if (e.code === "rollback") return new SyncError("rollback", e.message);
		if (e.code === "tampered" || e.code === "unknown_sender" || e.code === "wrong_session") return new SyncError("tampered", e.message);
	}
	return new SyncError("error", e instanceof Error ? e.message : String(e));
}
const DAY = 864e5;
var SyncEngine = class {
	spaceId;
	o;
	now;
	st;
	ring;
	chain = Promise.resolve();
	constructor(opts) {
		this.o = opts;
		this.spaceId = opts.spaceId;
		this.now = opts.now ?? Date.now;
		this.st = {
			...emptySyncState(),
			...opts.state.load() ?? {}
		};
		this.ring = opts.keys.load();
	}
	get state() {
		return this.st;
	}
	get hasKey() {
		return !!this.ring && this.ring.spaceId === this.spaceId;
	}
	/** Relay time (leases use it). */
	serverNow() {
		return this.now() + this.st.clockOffset;
	}
	profileState(id) {
		return this.st.profiles[id] ?? null;
	}
	conflicts(id) {
		return this.st.conflicts[id] ?? [];
	}
	/** Ciphertext bytes stored on the relay for a profile (all its parts). */
	storedBytes(profileId) {
		const ring = this.ring;
		if (!ring) return 0;
		let n = 0;
		for (const part of [
			...DATA_PARTS,
			"cookies",
			"lease"
		]) n += this.st.heads[syncBlobId(ring.current.nameKey, profileId, part)]?.size ?? 0;
		return n;
	}
	/** Serialise every operation: a sync round and a lease change never interleave. */
	run(fn) {
		const next = this.chain.then(fn, fn);
		this.chain = next.catch(() => {});
		return next;
	}
	save() {
		this.o.state.save(this.st);
	}
	stamp = (at) => {
		this.st.lc += 1;
		const now = this.now();
		return {
			at: at != null && at > 0 && at < now ? at : now,
			dev: this.o.deviceId,
			lc: this.st.lc
		};
	};
	seeLamport(...maps) {
		const m = maxLamport(...maps);
		if (m > this.st.lc) this.st.lc = m;
	}
	setProfile(id, patch) {
		const cur = this.st.profiles[id] ?? {
			enabled: false,
			paused: false,
			remoteOrigin: false,
			lastSyncAt: null,
			lastError: null,
			removedFromCloud: false
		};
		this.st.profiles[id] = {
			...cur,
			...patch
		};
	}
	key() {
		if (!this.ring) throw new SyncError("waiting_for_pc");
		return this.ring.current;
	}
	blobId(profileId, part) {
		return syncBlobId(this.key().nameKey, profileId, part);
	}
	/** Fetch this device's key wrap (first sync, or after a rotation). */
	async refreshKey() {
		const stored = this.o.keys.load();
		if (stored && stored.spaceId === this.spaceId && (!this.ring || this.ring.spaceId !== this.spaceId || stored.current.epoch > this.ring.current.epoch)) {
			this.ring = stored;
			return true;
		}
		const wrap = await this.o.client.get(this.spaceId, keyWrapBlobId(this.o.identity.dh.publicKey));
		if (!wrap) return false;
		const key = unwrapSyncKey({
			recipient: this.o.identity,
			envelope: wrap.data,
			spaceId: this.spaceId,
			resolveSender: () => this.o.ownerDhPub
		});
		const before = this.ring?.current.epoch ?? 0;
		this.ring = keyringAdd(this.ring && this.ring.spaceId === this.spaceId ? this.ring : null, this.spaceId, key);
		if (this.ring.current.epoch !== before) this.o.keys.save(this.ring);
		return true;
	}
	async fetchPart(part, blobId) {
		const got = await this.o.client.get(this.spaceId, blobId);
		if (!got) return null;
		const seen = this.st.seen[blobId] ?? 0;
		if (got.ver < seen) throw new ProtocolError("rollback", `Blob version ${got.ver} is older than ${seen}.`);
		let raw;
		try {
			raw = openBlob({
				keyFor: (e) => keyringLookup(this.ring, e),
				spaceId: this.spaceId,
				blobId,
				version: got.ver,
				data: got.data
			});
		} catch (e) {
			if (!(e instanceof ProtocolError) || e.code !== "no_key") throw e;
			if (!await this.refreshKey()) throw e;
			raw = openBlob({
				keyFor: (ep) => keyringLookup(this.ring, ep),
				spaceId: this.spaceId,
				blobId,
				version: got.ver,
				data: got.data
			});
		}
		const payload = checkPayload(part, raw);
		this.st.seen[blobId] = got.ver;
		this.st.heads[blobId] = {
			ver: got.ver,
			size: got.data.length
		};
		return {
			ver: got.ver,
			payload
		};
	}
	/** Compare and swap write. Returns the new version, or the relay's current version on a conflict. */
	async putPart(blobId, prev, payload) {
		const ver = Math.max(prev, this.st.seen[blobId] ?? 0, this.st.heads[blobId]?.ver ?? 0) + 1;
		const data = sealBlob({
			key: this.key(),
			spaceId: this.spaceId,
			blobId,
			version: ver,
			payload
		});
		const r = await this.o.client.put(this.spaceId, blobId, ver, prev, data);
		if (!r.ok) return {
			ok: false,
			ver: r.ver
		};
		this.st.seen[blobId] = ver;
		this.st.heads[blobId] = {
			ver,
			size: data.length
		};
		return {
			ok: true,
			ver
		};
	}
	applyList(blobs, reset) {
		if (reset) this.st.heads = {};
		for (const b of blobs) if (b.deleted) delete this.st.heads[b.id];
		else this.st.heads[b.id] = {
			ver: b.ver,
			size: b.size
		};
	}
	/** Refresh versions from the relay (cheap: no blob bodies). */
	async listSpace() {
		const l = await this.o.client.list(this.spaceId, this.st.seq);
		this.st.clockOffset = l.now - this.now();
		this.applyList(l.blobs, l.reset);
		this.st.seq = l.seq;
	}
	/** Turn sync on for a local profile (adds it to the space index; data uploads on the next round). */
	enable(profileId) {
		return this.run(async () => {
			this.setProfile(profileId, {
				enabled: true,
				paused: false,
				removedFromCloud: false,
				lastError: null
			});
			this.st.indexPending[profileId] = {
				op: "add",
				origin: this.o.origin
			};
			this.save();
		});
	}
	/** Stop syncing a profile on this device. `removeFromCloud` also deletes its blobs for every device. */
	disable(profileId, removeFromCloud) {
		return this.run(async () => {
			this.setProfile(profileId, { enabled: false });
			if (removeFromCloud) {
				this.st.indexPending[profileId] = { op: "remove" };
				if (this.ring) for (const part of [
					...DATA_PARTS,
					"cookies",
					"lease"
				]) {
					const id = this.blobId(profileId, part);
					await this.o.client.del(this.spaceId, id).catch(() => null);
					delete this.st.heads[id];
				}
				delete this.st.shadows[profileId];
				delete this.st.conflicts[profileId];
				delete this.st.jarApplied[profileId];
			}
			this.save();
		});
	}
	setPaused(profileId, paused) {
		this.setProfile(profileId, { paused });
		this.save();
	}
	setPausedAll(paused) {
		this.st.pausedAll = paused;
		this.save();
	}
	/** One full round: index, then every enabled profile. Never throws; errors are in the report. */
	syncAll() {
		return this.run(() => this.syncAllInner());
	}
	async syncAllInner() {
		const report = {
			ok: true,
			profiles: [],
			added: [],
			removed: []
		};
		if (this.st.pausedAll) return report;
		try {
			if (!this.ring || this.ring.spaceId !== this.spaceId) {
				if (!await this.refreshKey()) throw new SyncError("waiting_for_pc");
			}
			await this.listSpace();
			const idx = await this.syncIndex();
			report.added = idx.added;
			report.removed = idx.removed;
		} catch (e) {
			const err = toSyncError(e);
			this.save();
			return {
				...report,
				ok: false,
				error: err.code
			};
		}
		for (const [id, p] of Object.entries(this.st.profiles)) {
			if (!p.enabled || p.paused) continue;
			report.profiles.push(await this.syncProfileInner(id));
		}
		report.ok = report.profiles.every((p) => p.ok);
		this.save();
		return report;
	}
	syncProfile(profileId) {
		return this.run(async () => {
			try {
				if (!this.hasKey && !await this.refreshKey()) throw new SyncError("waiting_for_pc");
				await this.listSpace();
			} catch (e) {
				return {
					profileId,
					ok: false,
					uploaded: [],
					applied: [],
					created: false,
					conflicts: 0,
					error: toSyncError(e).code
				};
			}
			const r = await this.syncProfileInner(profileId);
			this.save();
			return r;
		});
	}
	async syncIndex() {
		const blobId = syncIndexBlobId(this.key().nameKey);
		const pending = { ...this.st.indexPending };
		const added = [];
		const removed = [];
		for (let attempt = 0;; attempt++) {
			const head = this.st.heads[blobId];
			const remote = head && head.ver > (this.st.seen[blobId] ?? 0) ? await this.fetchPart("index", blobId) : null;
			const remoteMap = remote ? remote.payload.profiles : this.st.seen[blobId] ? this.st.index : {};
			const prev = remote?.ver ?? head?.ver ?? 0;
			this.seeLamport(remoteMap);
			const local = { ...this.st.index };
			for (const [id, op] of Object.entries(pending)) local[id] = op.op === "add" ? {
				v: { origin: op.origin },
				s: this.stamp()
			} : {
				v: null,
				s: this.stamp()
			};
			const m = mergeEntries(this.st.index, local, remoteMap);
			const merged = pruneTombstones(m.merged, this.now(), 90 * DAY);
			if (m.uploadNeeded || !head) {
				const w = await this.putPart(blobId, prev, {
					v: 1,
					profiles: merged
				});
				if (!w.ok) {
					if (attempt >= (this.o.maxRetries ?? 4)) throw new SyncError("busy");
					this.st.heads[blobId] = {
						ver: w.ver,
						size: head?.size ?? 0
					};
					continue;
				}
			}
			for (const [id, e] of Object.entries(merged)) {
				const known = this.st.profiles[id];
				if (e.v && !known) {
					this.setProfile(id, {
						enabled: true,
						remoteOrigin: e.s.dev !== this.o.deviceId
					});
					added.push(id);
				} else if (e.v === null && known?.enabled && !(id in pending)) {
					this.setProfile(id, {
						enabled: false,
						removedFromCloud: true
					});
					removed.push(id);
				} else if (e.v && known && known.removedFromCloud) this.setProfile(id, { removedFromCloud: false });
			}
			this.st.index = merged;
			for (const id of Object.keys(pending)) delete this.st.indexPending[id];
			return {
				added,
				removed
			};
		}
	}
	async syncProfileInner(profileId) {
		const report = {
			profileId,
			ok: true,
			uploaded: [],
			applied: [],
			created: false,
			conflicts: 0
		};
		try {
			const local = await this.o.local.read(profileId);
			const shadow = { ...this.st.shadows[profileId] ?? {} };
			const out = {};
			const newConflicts = [];
			for (const part of DATA_PARTS) {
				const r = await this.syncPart(profileId, part, local, shadow, out, newConflicts);
				if (r.uploaded) report.uploaded.push(part);
				if (r.applied) report.applied.push(part);
			}
			if (Object.keys(out).length) {
				const create = !local;
				if (!create || out.meta) {
					await this.o.local.apply(profileId, JSON.parse(JSON.stringify(out)), create);
					report.created = create;
				}
			}
			this.st.shadows[profileId] = shadow;
			if (newConflicts.length) this.st.conflicts[profileId] = [...this.st.conflicts[profileId] ?? [], ...newConflicts].slice(-50);
			report.conflicts = (this.st.conflicts[profileId] ?? []).length;
			this.setProfile(profileId, {
				lastSyncAt: this.now(),
				lastError: null
			});
		} catch (e) {
			const err = toSyncError(e);
			report.ok = false;
			report.error = err.code;
			this.setProfile(profileId, { lastError: err.code });
		}
		return report;
	}
	async syncPart(profileId, part, local, shadow, out, conflictsOut) {
		const blobId = this.blobId(profileId, part);
		let uploaded = false;
		for (let attempt = 0;; attempt++) {
			const head = this.st.heads[blobId];
			const seen = this.st.seen[blobId] ?? 0;
			const fetched = head && head.ver > seen ? await this.fetchPart(part, blobId) : null;
			const remote = fetched ? {
				kind: "fetched",
				payload: fetched.payload
			} : head && seen ? { kind: "same" } : { kind: "none" };
			const prev = fetched?.ver ?? (remote.kind === "same" ? head.ver : 0);
			const step = this.mergePart(profileId, part, local, shadow, remote);
			if (step.conflicts.length) for (const c of step.conflicts) conflictsOut.push({
				part,
				id: c.id,
				kept: c.kept,
				other: c.other,
				at: this.now()
			});
			if (step.upload && (local || remote.kind !== "none")) {
				const w = await this.putPart(blobId, prev, step.payload);
				if (!w.ok) {
					if (attempt >= (this.o.maxRetries ?? 4)) throw new SyncError("busy");
					this.st.heads[blobId] = {
						ver: w.ver,
						size: head?.size ?? 0
					};
					conflictsOut.splice(conflictsOut.length - step.conflicts.length, step.conflicts.length);
					continue;
				}
				uploaded = true;
			}
			step.commit();
			if (step.apply) Object.assign(out, step.apply);
			return {
				uploaded,
				applied: !!step.apply
			};
		}
	}
	/** Pure part of a round for one part: what to upload, what to apply, the new shadow. */
	mergePart(profileId, part, local, shadow, remote) {
		const now = this.now();
		const fetched = remote.kind === "fetched" ? remote.payload : null;
		if (part === "meta") {
			const base = shadow.meta ?? {};
			const remoteMap = fetched ? fetched.fields : remote.kind === "same" ? base : {};
			this.seeLamport(remoteMap);
			const localMap = { ...base };
			if (local) for (const [f, value] of Object.entries(local.meta)) {
				const b = base[f];
				const val = value === void 0 ? null : value;
				if (!b || !sameValue(b.v, val)) localMap[f] = {
					v: val,
					s: this.stamp(local.editedAt?.meta)
				};
			}
			const m = mergeEntries(base, localMap, remoteMap);
			return {
				upload: m.uploadNeeded,
				payload: {
					v: 1,
					profileId,
					fields: m.merged
				},
				apply: !local || m.changedLocally.length ? { meta: Object.fromEntries(Object.entries(m.merged).map(([f, e]) => [f, e.v])) } : null,
				conflicts: [],
				commit: () => {
					shadow.meta = m.merged;
				}
			};
		}
		if (part === "tabs") {
			const base = shadow.tabs ?? {};
			const rp = fetched;
			const remoteMap = rp ? rp.items : remote.kind === "same" ? base : {};
			const remoteActive = rp ? rp.active : remote.kind === "same" ? shadow.active : void 0;
			this.seeLamport(remoteMap);
			const m = mergeEntries(base, local ? this.stampValues(base, local.tabs.items, local.editedAt?.tabs) : base, remoteMap);
			const merged = pruneTombstones(m.merged, now);
			let active = newestEntry(shadow.active, remoteActive);
			if (local && (!shadow.active || shadow.active.v !== local.tabs.active)) active = newestEntry(active, {
				v: local.tabs.active,
				s: this.stamp()
			});
			const activeChanged = !!local && (active?.v ?? null) !== local.tabs.active;
			const remoteActiveSame = !!active && !!remoteActive && sameStamp(remoteActive.s, active.s);
			return {
				upload: m.uploadNeeded || !!active && !remoteActiveSame,
				payload: {
					v: 1,
					profileId,
					items: merged,
					active: active ?? {
						v: null,
						s: this.stamp()
					}
				},
				apply: m.changedLocally.length || activeChanged || !local ? { tabs: {
					items: valuesOf(merged),
					active: active?.v ?? null
				} } : null,
				conflicts: m.conflicts,
				commit: () => {
					shadow.tabs = merged;
					if (active) shadow.active = active;
				}
			};
		}
		const base = (part === "bookmarks" ? shadow.bookmarks : shadow.history) ?? {};
		const remoteMap = fetched ? fetched.items : remote.kind === "same" ? base : {};
		this.seeLamport(remoteMap);
		const localValues = local ? part === "bookmarks" ? local.bookmarks : local.history : null;
		const m = mergeEntries(base, localValues ? this.stampValues(base, localValues, part === "bookmarks" ? local?.editedAt?.bookmarks : void 0) : base, remoteMap);
		let merged = pruneTombstones(m.merged, now);
		if (part === "history") merged = capEntries(merged, 500, (h) => h.visitedAt);
		return {
			upload: m.uploadNeeded,
			payload: {
				v: 1,
				profileId,
				items: merged
			},
			apply: m.changedLocally.length || !local ? { [part]: valuesOf(merged) } : null,
			conflicts: part === "bookmarks" ? m.conflicts : [],
			commit: () => {
				if (part === "bookmarks") shadow.bookmarks = merged;
				else shadow.history = merged;
			}
		};
	}
	stampValues(base, values, times) {
		const out = {};
		for (const [id, value] of Object.entries(values)) {
			const b = base[id];
			out[id] = b && b.v !== null && sameValue(b.v, value) ? b : {
				v: value,
				s: this.stamp(times?.[id])
			};
		}
		for (const [id, b] of Object.entries(base)) if (!(id in values)) out[id] = b.v === null ? b : {
			v: null,
			s: this.stamp()
		};
		return out;
	}
	/**
	* Resolve the stored conflicts of a profile. "newest" keeps what sync already chose;
	* "keepBoth" adds the losing tabs/bookmarks back as new items (uploaded on the next round).
	*/
	resolveConflicts(profileId, choice) {
		return this.run(async () => {
			const list = this.st.conflicts[profileId] ?? [];
			if (choice === "keepBoth" && list.length) {
				const local = await this.o.local.read(profileId);
				if (local) {
					const tabs = list.filter((c) => c.part === "tabs");
					const bms = list.filter((c) => c.part === "bookmarks");
					const patch = {};
					if (tabs.length) patch.tabs = {
						items: valuesOf(keepBoth(this.entriesOf(local.tabs.items), tabs, this.stamp)),
						active: local.tabs.active
					};
					if (bms.length) patch.bookmarks = valuesOf(keepBoth(this.entriesOf(local.bookmarks), bms, this.stamp));
					await this.o.local.apply(profileId, patch, false);
				}
			}
			delete this.st.conflicts[profileId];
			this.save();
		});
	}
	entriesOf(values) {
		const s = this.stamp();
		return Object.fromEntries(Object.entries(values).map(([id, v]) => [id, {
			v,
			s
		}]));
	}
	async readLease(profileId) {
		const blobId = this.blobId(profileId, "lease");
		const got = await this.fetchPart("lease", blobId);
		return got ? {
			rec: got.payload,
			ver: got.ver
		} : {
			rec: emptyLease(profileId),
			ver: 0
		};
	}
	/** Who holds the profile right now (relay clock), without changing anything. */
	holder(profileId) {
		return this.run(async () => {
			await this.listSpace();
			const { rec } = await this.readLease(profileId);
			return leaseHolder(rec, this.serverNow());
		});
	}
	/**
	* Take the profile before opening it. With `takeover` it is taken from the current holder
	* (the old holder notices on its next renew, saves a conflict snapshot and closes). On success
	* the newest cookie jar is applied (whole jar replace).
	*/
	acquire(profileId, opts = {}) {
		return this.run(async () => {
			try {
				if (!this.hasKey && !await this.refreshKey()) throw new SyncError("waiting_for_pc");
				await this.listSpace();
				for (let attempt = 0;; attempt++) {
					const { rec, ver } = await this.readLease(profileId);
					const now = this.serverNow();
					const step = opts.takeover ? leaseTakeover(rec, this.o.deviceId, this.o.deviceName, now) : leaseAcquire(rec, this.o.deviceId, this.o.deviceName, now);
					if (!step.ok) return step.reason === "in_use" ? {
						ok: false,
						reason: "in_use",
						holder: step.holder
					} : {
						ok: false,
						reason: "lost",
						holder: step.holder
					};
					if (!(await this.putPart(this.blobId(profileId, "lease"), ver, step.rec)).ok) {
						if (attempt >= (this.o.maxRetries ?? 4)) throw new SyncError("busy");
						continue;
					}
					this.st.leases[profileId] = { epoch: step.rec.epoch };
					const cookiesApplied = await this.pullJar(profileId, step.rec);
					this.save();
					return {
						ok: true,
						epoch: step.rec.epoch,
						...step.previous ? { previous: step.previous } : {},
						cookiesApplied
					};
				}
			} catch (e) {
				this.save();
				return {
					ok: false,
					reason: "error",
					error: toSyncError(e).code
				};
			}
		});
	}
	async pullJar(profileId, rec) {
		if (!rec.jar || this.st.jarApplied[profileId] === rec.jar.version) return false;
		const got = await this.fetchPart("cookies", this.blobId(profileId, "cookies"));
		if (!got || !jarAccepted(rec, got.payload, got.ver)) return false;
		await this.o.local.replaceCookies(profileId, got.payload.cookies);
		this.st.jarApplied[profileId] = got.ver;
		return true;
	}
	/** Keep the lease alive (every 30 s while the profile is open). */
	renew(profileId) {
		return this.leaseWrite(profileId, false, false);
	}
	/** Upload the cookie jar and renew (on app background: phones can be closed without a release). */
	checkpoint(profileId) {
		return this.leaseWrite(profileId, true, false);
	}
	/** Upload the cookie jar and release the lease (profile closed). */
	release(profileId) {
		return this.leaseWrite(profileId, true, true);
	}
	leaseWrite(profileId, withJar, release) {
		return this.run(async () => {
			const held = this.st.leases[profileId];
			if (!held) return {
				ok: false,
				reason: "lost",
				holder: null
			};
			try {
				await this.listSpace();
				let jar;
				if (withJar) {
					const { rec } = await this.readLease(profileId);
					const check = leaseRenew(rec, this.o.deviceId, held.epoch, this.serverNow());
					if (!check.ok) return this.lost(profileId, check.holder);
					jar = await this.pushJar(profileId, held.epoch);
				}
				for (let attempt = 0;; attempt++) {
					const { rec, ver } = await this.readLease(profileId);
					const now = this.serverNow();
					const step = release ? leaseRelease(rec, this.o.deviceId, held.epoch, now, jar) : jar ? leaseCheckpoint(rec, this.o.deviceId, held.epoch, now, jar) : leaseRenew(rec, this.o.deviceId, held.epoch, now);
					if (!step.ok) return this.lost(profileId, step.holder);
					if (!(await this.putPart(this.blobId(profileId, "lease"), ver, step.rec)).ok) {
						if (attempt >= (this.o.maxRetries ?? 4)) throw new SyncError("busy");
						continue;
					}
					if (release) delete this.st.leases[profileId];
					this.save();
					return {
						ok: true,
						epoch: held.epoch,
						cookiesApplied: false
					};
				}
			} catch (e) {
				this.save();
				return {
					ok: false,
					reason: "error",
					error: toSyncError(e).code
				};
			}
		});
	}
	lost(profileId, holder) {
		delete this.st.leases[profileId];
		this.save();
		return {
			ok: false,
			reason: "lost",
			holder
		};
	}
	async pushJar(profileId, epoch) {
		const cookies = await this.o.local.readCookies(profileId);
		const blobId = this.blobId(profileId, "cookies");
		const payload = {
			v: 1,
			profileId,
			leaseEpoch: epoch,
			by: this.o.deviceId,
			at: this.now(),
			cookies
		};
		let prev = this.st.heads[blobId]?.ver ?? 0;
		for (let attempt = 0;; attempt++) {
			const w = await this.putPart(blobId, prev, payload);
			if (w.ok) {
				this.st.jarApplied[profileId] = w.ver;
				return {
					epoch,
					version: w.ver
				};
			}
			if (attempt >= (this.o.maxRetries ?? 4)) throw new SyncError("busy");
			prev = w.ver;
			this.st.heads[blobId] = {
				ver: w.ver,
				size: 0
			};
		}
	}
	/** True while this device holds the profile's lease (local view). */
	holds(profileId) {
		return !!this.st.leases[profileId];
	}
};
//#endregion
//#region protocol/dist/sync/owner.js
function pub(m) {
	return typeof m.dhPub === "string" ? fromBase64Url(m.dhPub) : m.dhPub;
}
var SyncSpaceOwner = class {
	o;
	constructor(o) {
		this.o = o;
	}
	ring() {
		const r = this.o.keys.load();
		return r && r.spaceId === this.o.spaceId ? r : null;
	}
	/** Create the space (first time) and give every member the current key. Safe to call again. */
	async setup(members) {
		let ring = this.ring();
		if (!ring) {
			ring = keyringAdd(null, this.o.spaceId, generateSyncKey(1));
			this.o.keys.save(ring);
		}
		await this.o.client.setMembers(this.o.spaceId, members.map((m) => m.mailbox));
		for (const m of members) await this.putWrap(ring, m);
		return ring;
	}
	async putWrap(ring, m) {
		const id = keyWrapBlobId(pub(m));
		const data = wrapSyncKey({
			sender: this.o.identity,
			recipientDhPub: pub(m),
			spaceId: this.o.spaceId,
			key: ring.current,
			...this.o.now ? { now: this.o.now() } : {}
		});
		for (let attempt = 0; attempt < 5; attempt++) {
			const prev = (await this.o.client.get(this.o.spaceId, id))?.ver ?? 0;
			if ((await this.o.client.put(this.o.spaceId, id, prev + 1, prev, data)).ok) return;
		}
		throw new Error("Could not write the key wrap.");
	}
	/**
	* Remove a device: it loses relay access at once (member list), its key wrap is deleted, a new
	* key epoch goes to the remaining members and every blob is sealed again with the new key, so
	* what the removed device may have copied before is the only thing it ever had.
	*/
	async removeMember(removed, remaining) {
		const old = this.ring();
		if (!old) throw new Error("Sync is not set up.");
		await this.o.client.setMembers(this.o.spaceId, remaining.map((m) => m.mailbox));
		await this.o.client.del(this.o.spaceId, keyWrapBlobId(pub(removed))).catch(() => null);
		const ring = keyringAdd(old, this.o.spaceId, generateSyncKey(old.current.epoch + 1, old.current.nameKey));
		this.o.keys.save(ring);
		for (const m of remaining) await this.putWrap(ring, m);
		return { resealed: await this.resealAll(ring) };
	}
	/** Seal every blob that still uses an older key epoch with the current key. */
	async resealAll(ring) {
		const list = await this.o.client.list(this.o.spaceId, 0);
		let n = 0;
		for (const b of list.blobs) {
			if (b.deleted || b.id.startsWith("kw-")) continue;
			for (let attempt = 0; attempt < 5; attempt++) {
				const got = await this.o.client.get(this.o.spaceId, b.id);
				if (!got) break;
				if (blobEpoch(got.data) === ring.current.epoch) break;
				const payload = openBlob({
					keyFor: (e) => keyringLookup(ring, e),
					spaceId: this.o.spaceId,
					blobId: b.id,
					version: got.ver,
					data: got.data
				});
				const data = sealBlob({
					key: ring.current,
					spaceId: this.o.spaceId,
					blobId: b.id,
					version: got.ver + 1,
					payload
				});
				if ((await this.o.client.put(this.o.spaceId, b.id, got.ver + 1, got.ver, data)).ok) {
					n++;
					break;
				}
			}
		}
		return n;
	}
	/** "Remove from cloud" for the whole workspace: deletes the space and every blob. */
	async deleteAll() {
		await this.o.client.deleteSpace(this.o.spaceId);
	}
	/** For logs and tests: the key id of the current epoch (never the key). */
	currentEpoch() {
		return this.ring()?.current.epoch ?? 0;
	}
};
//#endregion
exports.ALERT_KINDS = ALERT_KINDS;
exports.APPROVAL_DECISIONS = APPROVAL_DECISIONS;
exports.COMMAND_MAX_AGE_MS = COMMAND_MAX_AGE_MS;
exports.COMMAND_SCOPES = COMMAND_SCOPES;
exports.COMMAND_TYPES = COMMAND_TYPES;
exports.CipherState = CipherState;
exports.ClientFrameSchema = ClientFrameSchema;
exports.CommandSchema = CommandSchema;
exports.DeviceInfoSchema = DeviceInfoSchema;
exports.ENVELOPE_VERSION = ENVELOPE_VERSION;
exports.EnvelopeKind = EnvelopeKind;
exports.Handshake = Handshake;
exports.LEASE_OPS = LEASE_OPS;
exports.LEASE_RENEW_EVERY_MS = LEASE_RENEW_EVERY_MS;
exports.LEASE_TTL_MS = LEASE_TTL_MS;
exports.LeaseTable = LeaseTable;
exports.MAILBOX_ID_RE = MAILBOX_ID_RE;
exports.MAX_BOOKMARKS = MAX_BOOKMARKS;
exports.MAX_COOKIES = MAX_COOKIES;
exports.MAX_ENVELOPE_BYTES = MAX_ENVELOPE_BYTES;
exports.MAX_FUTURE_SKEW_MS = MAX_FUTURE_SKEW_MS;
exports.MAX_HISTORY = MAX_HISTORY;
exports.MAX_NONCE = MAX_NONCE;
exports.MAX_PLAINTEXT = MAX_PLAINTEXT;
exports.MAX_RELAY_FRAME_BYTES = MAX_RELAY_FRAME_BYTES;
exports.MAX_TABS = MAX_TABS;
exports.META_FIELDS = META_FIELDS;
exports.MIN_SUPPORTED_VERSION = MIN_SUPPORTED_VERSION;
exports.MessageSchema = MessageSchema;
exports.OWNER_DEFAULT_SCOPES = OWNER_DEFAULT_SCOPES;
exports.PAD_BUCKETS = PAD_BUCKETS;
exports.PAIRING_MAX_ATTEMPTS = PAIRING_MAX_ATTEMPTS;
exports.PAIRING_TTL_MS = PAIRING_TTL_MS;
exports.PLATFORMS = PLATFORMS;
exports.PROFILE_STATUSES = PROFILE_STATUSES;
exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
exports.PUSH_KINDS = PUSH_KINDS;
exports.PairingOffer = PairingOffer;
exports.ProfileSummarySchema = ProfileSummarySchema;
exports.ProtocolError = ProtocolError;
exports.QR_PREFIX = QR_PREFIX;
exports.QR_VERSION = QR_VERSION;
exports.REKEY_AFTER_MESSAGES = REKEY_AFTER_MESSAGES;
exports.REKEY_AFTER_MS = REKEY_AFTER_MS;
exports.RELAY_PROTOCOL_VERSION = RELAY_PROTOCOL_VERSION;
exports.REPLAY_WINDOW = REPLAY_WINDOW;
exports.RESULT_CODES = RESULT_CODES;
exports.ReplayWindow = ReplayWindow;
exports.SCOPES = SCOPES;
exports.SEALED_MAX_AGE_MS = SEALED_MAX_AGE_MS;
exports.SEEN_ID_TTL_MS = SEEN_ID_TTL_MS;
exports.SYNC_AUTH_MAX_SKEW_MS = SYNC_AUTH_MAX_SKEW_MS;
exports.SYNC_HEADERS = SYNC_HEADERS;
exports.SYNC_ID_RE = SYNC_ID_RE;
exports.SYNC_LEASE_RENEW_MS = LEASE_RENEW_EVERY_MS;
exports.SYNC_LEASE_TTL_MS = LEASE_TTL_MS;
exports.SYNC_MAX_BLOB_BYTES = SYNC_MAX_BLOB_BYTES;
exports.SYNC_PARTS = SYNC_PARTS;
exports.SeenCache = SeenCache;
exports.Session = Session;
exports.SyncEngine = SyncEngine;
exports.SyncError = SyncError;
exports.SyncHttpError = SyncHttpError;
exports.SyncPayloadError = SyncPayloadError;
exports.SyncRelayClient = SyncRelayClient;
exports.SyncSpaceOwner = SyncSpaceOwner;
exports.TEAM_REQUEST_KINDS = TEAM_REQUEST_KINDS;
exports.ValidationError = ValidationError;
exports.acceptSession = acceptSession;
exports.aeadDecrypt = aeadDecrypt;
exports.aeadEncrypt = aeadEncrypt;
exports.authPayload = authPayload;
exports.base32Decode = base32Decode;
exports.base32Encode = base32Encode;
exports.blobEpoch = blobEpoch;
exports.buildAuthFrame = buildAuthFrame;
exports.bytesToHex = bytesToHex;
exports.capEntries = capEntries;
exports.checkFreshness = checkFreshness;
exports.checkPayload = checkPayload;
exports.checkScope = checkScope;
exports.commandAllowed = commandAllowed;
exports.compareStamp = compareStamp;
exports.computeSas = computeSas;
exports.concat = concat;
exports.createMessage = createMessage;
exports.decodeMessage = decodeMessage;
exports.decodePairingPayload = decodePairingPayload;
exports.dh = dh;
exports.emptyLease = emptyLease;
exports.emptySyncState = emptySyncState;
exports.encodeMessage = encodeMessage;
exports.encodePairingPayload = encodePairingPayload;
exports.equalBytes = equalBytes;
exports.equalStrings = equalStrings;
exports.exportIdentity = exportIdentity;
exports.exportKeyring = exportKeyring;
exports.fromBase64Url = fromBase64Url;
exports.generateEd25519 = generateEd25519;
exports.generateIdentity = generateIdentity;
exports.generateSyncKey = generateSyncKey;
exports.generateX25519 = generateX25519;
exports.header = header;
exports.hexToBytes = hexToBytes;
exports.hotp = hotp;
exports.importIdentity = importIdentity;
exports.importKeyring = importKeyring;
exports.isScope = isScope;
exports.isValidMessage = isValidMessage;
exports.jarAccepted = jarAccepted;
exports.keepBoth = keepBoth;
exports.keyId = keyId;
exports.keyWrapBlobId = keyWrapBlobId;
exports.keyWrapSender = keyWrapSender;
exports.keyringAdd = keyringAdd;
exports.keyringLookup = keyringLookup;
exports.leaseAcquire = leaseAcquire;
exports.leaseCheckpoint = leaseCheckpoint;
exports.leaseHolder = leaseHolder;
exports.leaseRelease = leaseRelease;
exports.leaseRenew = leaseRenew;
exports.leaseTakeover = leaseTakeover;
exports.mailboxIdFromSignKey = mailboxIdFromSignKey;
exports.maxLamport = maxLamport;
exports.mergeEntries = mergeEntries;
exports.newMessageId = newMessageId;
exports.newestEntry = newestEntry;
exports.noiseNonce = noiseNonce;
exports.openBlob = openBlob;
exports.openSealed = openSealed;
exports.pad = pad;
exports.paddedSize = paddedSize;
exports.pairingIdFromSecret = pairingIdFromSecret;
exports.pairingIdOfEnvelope = pairingIdOfEnvelope;
exports.parseClientFrame = parseClientFrame;
exports.parseOtpauthUri = parseOtpauthUri;
exports.parseScopes = parseScopes;
exports.peekEnvelope = peekEnvelope;
exports.protocolName = protocolName;
exports.pruneTombstones = pruneTombstones;
exports.randomBytes = randomBytes;
exports.readU32be = readU32be;
exports.readU64be = readU64be;
exports.requiredScope = requiredScope;
exports.sameStamp = sameStamp;
exports.sameValue = sameValue;
exports.sasMatches = sasMatches;
exports.sealBlob = sealBlob;
exports.sealTo = sealTo;
exports.sealedSenderKeyId = sealedSenderKeyId;
exports.setRandomSource = setRandomSource;
exports.sign = sign;
exports.signSyncRequest = signSyncRequest;
exports.stableJson = stableJson;
exports.stampLocal = stampLocal;
exports.startPairing = startPairing;
exports.startSession = startSession;
exports.syncAuthPayload = syncAuthPayload;
exports.syncBlobId = syncBlobId;
exports.syncBodyHash = syncBodyHash;
exports.syncIndexBlobId = syncIndexBlobId;
exports.syncSpaceId = syncSpaceId;
exports.toBase64Url = toBase64Url;
exports.toSyncError = toSyncError;
exports.totp = totp;
exports.totpRaw = totpRaw;
exports.totpToken = totpToken;
exports.u32be = u32be;
exports.u64be = u64be;
exports.unpad = unpad;
exports.unwrapSyncKey = unwrapSyncKey;
exports.utf8Decode = utf8Decode;
exports.utf8Encode = utf8Encode;
exports.uuidv7 = uuidv7;
exports.validateMessage = validateMessage;
exports.validateRelayUrl = validateRelayUrl;
exports.valuesOf = valuesOf;
exports.verify = verify;
exports.wipe = wipe;
exports.wrapSyncKey = wrapSyncKey;
