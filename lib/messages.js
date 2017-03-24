var protobuf = require('protocol-buffers')

module.exports = protobuf(`
  message Index {
    required string type = 1;
    optional bytes content = 2;
  }

  message Stat {
    message Content {
      required uint64 length = 1;
      required uint64 byteLength = 2;
    }

    required uint32 mode = 1;
    optional uint32 uid = 2;
    optional uint32 gid = 3;
    optional uint64 size = 4;
    optional uint64 blocks = 5;
    optional uint64 mtime = 6;
    optional uint64 ctime = 7;

    // TODO: use ino to store the content feed cause why not ...
    // TODO: support hardlinks
    // required uint64 ino = 8;
    // required uint64 inosize = 9;

    required Content head = 8;
    optional string linkname = 9;
  }
`)
