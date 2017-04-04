var protobuf = require('protocol-buffers')

module.exports = protobuf(`
  message Index {
    required string type = 1;
    optional bytes content = 2;
  }

  message Stat {
    required uint32 mode = 1;
    optional uint32 uid = 2;
    optional uint32 gid = 3;
    optional uint64 size = 4;
    optional uint64 blocks = 5;
    optional uint64 offset = 6;
    optional uint64 byteOffset = 7;
    optional uint64 mtime = 8;
    optional uint64 ctime = 9;
  }
`)
