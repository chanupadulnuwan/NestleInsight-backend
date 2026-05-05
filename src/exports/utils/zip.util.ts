type ZipEntry = {
  name: string;
  data: Buffer | string;
  modifiedAt?: Date;
};

function toBuffer(data: Buffer | string) {
  return Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;

  return { dosDate, dosTime };
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];

    for (let bit = 0; bit < 8; bit += 1) {
      const carry = crc & 1;
      crc >>>= 1;
      if (carry) {
        crc ^= 0xedb88320;
      }
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf8');
    const data = toBuffer(entry.data);
    const checksum = crc32(data);
    const modifiedAt = entry.modifiedAt ?? new Date();
    const { dosDate, dosTime } = toDosDateTime(modifiedAt);

    const localHeader = Buffer.alloc(30 + fileName.length);
    let cursor = 0;
    localHeader.writeUInt32LE(0x04034b50, cursor);
    cursor += 4;
    localHeader.writeUInt16LE(20, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(dosTime, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(dosDate, cursor);
    cursor += 2;
    localHeader.writeUInt32LE(checksum, cursor);
    cursor += 4;
    localHeader.writeUInt32LE(data.length, cursor);
    cursor += 4;
    localHeader.writeUInt32LE(data.length, cursor);
    cursor += 4;
    localHeader.writeUInt16LE(fileName.length, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    fileName.copy(localHeader, cursor);

    localParts.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + fileName.length);
    cursor = 0;
    centralHeader.writeUInt32LE(0x02014b50, cursor);
    cursor += 4;
    centralHeader.writeUInt16LE(20, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(20, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(dosTime, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(dosDate, cursor);
    cursor += 2;
    centralHeader.writeUInt32LE(checksum, cursor);
    cursor += 4;
    centralHeader.writeUInt32LE(data.length, cursor);
    cursor += 4;
    centralHeader.writeUInt32LE(data.length, cursor);
    cursor += 4;
    centralHeader.writeUInt16LE(fileName.length, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt32LE(0, cursor);
    cursor += 4;
    centralHeader.writeUInt32LE(offset, cursor);
    cursor += 4;
    fileName.copy(centralHeader, cursor);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const endOfCentralDirectory = Buffer.alloc(22);

  let cursor = 0;
  endOfCentralDirectory.writeUInt32LE(0x06054b50, cursor);
  cursor += 4;
  endOfCentralDirectory.writeUInt16LE(0, cursor);
  cursor += 2;
  endOfCentralDirectory.writeUInt16LE(0, cursor);
  cursor += 2;
  endOfCentralDirectory.writeUInt16LE(entries.length, cursor);
  cursor += 2;
  endOfCentralDirectory.writeUInt16LE(entries.length, cursor);
  cursor += 2;
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, cursor);
  cursor += 4;
  endOfCentralDirectory.writeUInt32LE(localDirectory.length, cursor);
  cursor += 4;
  endOfCentralDirectory.writeUInt16LE(0, cursor);

  return Buffer.concat([
    localDirectory,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}
