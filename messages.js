var protobuf = require('protocol-buffers')

module.exports = protobuf(`
  message Index {
    required string type = 1;
    optional bytes content = 2;
  }

  message Stat {
    message Head {
      required uint64 length = 1;
      required uint64 byteLength = 2;
    }

    required uint64 size = 1;
    required uint64 blocks = 2;

    required Head head = 3;
  }
`)
