import { v4 } from "./deps.ts";
import { encode } from "./deps.ts";

export class Neo4j {
  private url: string;
  private username?: string;
  private password?: string;
  private database?: string;
  private encrypted: boolean;
  private ws?: WebSocket;
  private messageId: number = 0;
  private resolvers = new Map<number, { resolve: (value: any) => void; reject: (reason?: any) => void }>();

  constructor(url: string, options?: { username?: string; password?: string; database?: string; encrypted?: boolean }) {
    this.url = url;
    this.username = options?.username;
    this.password = options?.password;
    this.database = options?.database;
    this.encrypted = options?.encrypted ?? false;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = this.encrypted ? "wss" : "ws";
      this.ws = new WebSocket(`${protocol}://${this.url.replace(/^(neo4j|bolt):\/\//, "")}/bolt`);

      this.ws.onopen = async () => {
        try {
          await this.sendHandshake();
          await this.sendHello();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        reject(new Error("WebSocket connection error"));
      };

      this.ws.onclose = (event) => {
        console.log("WebSocket closed:", event);
        this.resolvers.forEach(({ reject }) => reject(new Error("WebSocket closed unexpectedly")));
        this.resolvers.clear();
      };
    });
  }

  private send(message: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      throw new Error("WebSocket is not open.");
    }
  }

  private async sendHandshake(): Promise<void> {
    const handshake = new Uint8Array([0x60, 0x60, 0xb0, 0x17, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    this.send(handshake);
    await this.waitForResponse(); // Wait for the server to acknowledge handshake
  }

  private async sendHello(): Promise<void> {
    const auth = this.username && this.password ? {
      scheme: "basic",
      principal: this.username,
      credentials: this.password,
    } : { scheme: "none" };

    const helloMessage = this.packMessage(0x01, {
      user_agent: "deno-neo4j/1.0",
      scheme: "basic",
      principal: this.username,
      credentials: this.password,
      database: this.database || "neo4j",
    });
    this.send(helloMessage);
    await this.waitForResponse(); // Wait for the server to acknowledge hello
  }

  async query(cypher: string, params: Record<string, any> = {}): Promise<any> {
    const runMessage = this.packMessage(0x10, cypher, params);
    const pullMessage = this.packMessage(0x31, { n: -1 }); // Pull all records

    this.send(runMessage);
    this.send(pullMessage);

    const response = await this.waitForResponse();
    return response;
  }

  private packMessage(signature: number, ...fields: any[]): Uint8Array {
    const packer = new Packer();
    packer.packStruct(signature, fields.length);
    fields.forEach(field => packer.pack(field));
    return packer.getBuffer();
  }

  private async waitForResponse(): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      this.resolvers.set(id, { resolve, reject });
      // Implement a timeout here if needed
    });
  }

  private handleMessage(data: ArrayBuffer): void {
    const unpacker = new Unpacker(new Uint8Array(data));
    const signature = unpacker.unpackStructSignature();
    const fields = unpacker.unpackStructFields();

    const resolver = this.resolvers.get(this.messageId - 1); // Assuming responses are in order
    if (!resolver) return;

    switch (signature) {
      case 0x70: // SUCCESS
        resolver.resolve(fields[0]);
        break;
      case 0x7E: // FAILURE
        resolver.reject(new Error(fields[0].message));
        break;
      case 0x7F: // IGNORED
        resolver.reject(new Error("Server ignored the message."));
        break;
      case 0x7D: // RECORD
        // Records are part of a stream, handled by the pull response
        break;
      default:
        console.warn("Unknown message signature:", signature);
        break;
    }
  }

  async close(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const goodbyeMessage = this.packMessage(0x02);
      this.send(goodbyeMessage);
      this.ws.close();
    }
  }
}

class Packer {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor() {
    this.buffer = new Uint8Array(1024);
    this.view = new DataView(this.buffer.buffer);
    this.offset = 0;
  }

  private ensureCapacity(bytes: number): void {
    if (this.offset + bytes > this.buffer.length) {
      const newBuffer = new Uint8Array(this.buffer.length * 2);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer.buffer);
    }
  }

  packStruct(signature: number, fields: number): void {
    this.ensureCapacity(2);
    this.view.setUint8(this.offset++, 0xB0 + fields);
    this.view.setUint8(this.offset++, signature);
  }

  pack(value: any): void {
    if (typeof value === "string") {
      this.packString(value);
    } else if (typeof value === "number") {
      this.packNumber(value);
    } else if (typeof value === "boolean") {
      this.packBoolean(value);
    } else if (value === null) {
      this.packNull();
    } else if (Array.isArray(value)) {
      this.packList(value);
    } else if (typeof value === "object") {
      this.packMap(value);
    } else {
      throw new Error("Unsupported type: " + typeof value);
    }
  }

  private packString(value: string): void {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(value);
    this.ensureCapacity(5 + encoded.length);
    if (encoded.length < 0x10) {
      this.view.setUint8(this.offset++, 0x80 + encoded.length);
    } else if (encoded.length < 0x100) {
      this.view.setUint8(this.offset++, 0xD0);
      this.view.setUint8(this.offset++, encoded.length);
    } else if (encoded.length < 0x10000) {
      this.view.setUint8(this.offset++, 0xD1);
      this.view.setUint16(this.offset, encoded.length, false);
      this.offset += 2;
    } else {
      this.view.setUint8(this.offset++, 0xD2);
      this.view.setUint32(this.offset, encoded.length, false);
      this.offset += 4;
    }
    this.buffer.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  private packNumber(value: number): void {
    this.ensureCapacity(9);
    if (value >= -0x20 && value < 0x80) {
      this.view.setInt8(this.offset++, value);
    } else if (value >= -0x80 && value < 0x80) {
      this.view.setUint8(this.offset++, 0xC8);
      this.view.setInt8(this.offset++, value);
    } else if (value >= -0x8000 && value < 0x8000) {
      this.view.setUint8(this.offset++, 0xC9);
      this.view.setInt16(this.offset, value, false);
      this.offset += 2;
    } else if (value >= -0x80000000 && value < 0x80000000) {
      this.view.setUint8(this.offset++, 0xCA);
      this.view.setInt32(this.offset, value, false);
      this.offset += 4;
    } else {
      this.view.setUint8(this.offset++, 0xCB);
      this.view.setFloat64(this.offset, value, false);
      this.offset += 8;
    }
  }

  private packBoolean(value: boolean): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset++, value ? 0xC3 : 0xC2);
  }

  private packNull(): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset++, 0xC0);
  }

  private packList(value: any[]): void {
    this.ensureCapacity(5);
    if (value.length < 0x10) {
      this.view.setUint8(this.offset++, 0x90 + value.length);
    } else if (value.length < 0x100) {
      this.view.setUint8(this.offset++, 0xD4);
      this.view.setUint8(this.offset++, value.length);
    } else if (value.length < 0x10000) {
      this.view.setUint8(this.offset++, 0xD5);
      this.view.setUint16(this.offset, value.length, false);
      this.offset += 2;
    } else {
      this.view.setUint8(this.offset++, 0xD6);
      this.view.setUint32(this.offset, value.length, false);
      this.offset += 4;
    }
    value.forEach(item => this.pack(item));
  }

  private packMap(value: Record<string, any>): void {
    const keys = Object.keys(value);
    this.ensureCapacity(5);
    if (keys.length < 0x10) {
      this.view.setUint8(this.offset++, 0xA0 + keys.length);
    } else if (keys.length < 0x100) {
      this.view.setUint8(this.offset++, 0xD8);
      this.view.setUint8(this.offset++, keys.length);
    } else if (keys.length < 0x10000) {
      this.view.setUint8(this.offset++, 0xD9);
      this.view.setUint16(this.offset, keys.length, false);
      this.offset += 2;
    } else {
      this.view.setUint8(this.offset++, 0xDA);
      this.view.setUint32(this.offset, keys.length, false);
      this.offset += 4;
    }
    keys.forEach(key => {
      this.packString(key);
      this.pack(value[key]);
    });
  }

  getBuffer(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }
}

class Unpacker {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.offset = 0;
  }

  unpackStructSignature(): number {
    const marker = this.view.getUint8(this.offset++);
    if ((marker & 0xF0) !== 0xB0) {
      throw new Error("Not a struct marker: " + marker.toString(16));
    }
    return this.view.getUint8(this.offset++);
  }

  unpackStructFields(): any[] {
    const marker = this.view.getUint8(this.offset - 2); // Get the struct marker again
    const numFields = marker & 0x0F;
    const fields: any[] = [];
    for (let i = 0; i < numFields; i++) {
      fields.push(this.unpack());
    }
    return fields;
  }

  unpack(): any {
    const marker = this.view.getUint8(this.offset++);
    if ((marker & 0xF0) === 0x80) {
      return this.unpackString(marker & 0x0F);
    } else if ((marker & 0xF0) === 0x90) {
      return this.unpackList(marker & 0x0F);
    } else if ((marker & 0xF0) === 0xA0) {
      return this.unpackMap(marker & 0x0F);
    } else if ((marker & 0xF0) === 0xB0) {
      this.offset--; // Rewind to re-read struct marker
      return this.unpackStruct();
    } else if (marker === 0xC0) {
      return null;
    } else if (marker === 0xC2) {
      return false;
    } else if (marker === 0xC3) {
      return true;
    } else if (marker === 0xD0) {
      return this.unpackString(this.view.getUint8(this.offset++));
    } else if (marker === 0xD1) {
      const length = this.view.getUint16(this.offset, false);
      this.offset += 2;
      return this.unpackString(length);
    } else if (marker === 0xD2) {
      const length = this.view.getUint32(this.offset, false);
      this.offset += 4;
      return this.unpackString(length);
    } else if (marker === 0xD4) {
      return this.unpackList(this.view.getUint8(this.offset++));
    } else if (marker === 0xD5) {
      const length = this.view.getUint16(this.offset, false);
      this.offset += 2;
      return this.unpackList(length);
    } else if (marker === 0xD6) {
      const length = this.view.getUint32(this.offset, false);
      this.offset += 4;
      return this.unpackList(length);
    } else if (marker === 0xD8) {
      return this.unpackMap(this.view.getUint8(this.offset++));
    } else if (marker === 0xD9) {
      const length = this.view.getUint16(this.offset, false);
      this.offset += 2;
      return this.unpackMap(length);
    } else if (marker === 0xDA) {
      const length = this.view.getUint32(this.offset, false);
      this.offset += 4;
      return this.unpackMap(length);
    } else if (marker === 0xC8) {
      return this.view.getInt8(this.offset++);
    } else if (marker === 0xC9) {
      const value = this.view.getInt16(this.offset, false);
      this.offset += 2;
      return value;
    } else if (marker === 0xCA) {
      const value = this.view.getInt32(this.offset, false);
      this.offset += 4;
      return value;
    } else if (marker === 0xCB) {
      const value = this.view.getFloat64(this.offset, false);
      this.offset += 8;
      return value;
    } else if (marker >= 0 && marker < 0x80) {
      return marker;
    } else if (marker >= 0xE0 && marker < 0x100) {
      return marker - 0x100;
    } else {
      throw new Error("Unsupported marker: " + marker.toString(16));
    }
  }

  private unpackString(length: number): string {
    const decoder = new TextDecoder();
    const value = decoder.decode(this.buffer.slice(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  private unpackList(length: number): any[] {
    const list: any[] = [];
    for (let i = 0; i < length; i++) {
      list.push(this.unpack());
    }
    return list;
  }

  private unpackMap(length: number): Record<string, any> {
    const map: Record<string, any> = {};
    for (let i = 0; i < length; i++) {
      const key = this.unpack();
      map[key] = this.unpack();
    }
    return map;
  }

  private unpackStruct(): any {
    const signature = this.unpackStructSignature();
    const fields = this.unpackStructFields();
    return { signature, fields };
  }
}