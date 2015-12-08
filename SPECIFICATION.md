# Hyperdrive Specification

## DRAFT Version 0

A design and specification document for Hyperdrive. Hyperdrive is a protocol and network for distributing and replicating static feeds of binary data.
The protocol itself draws heavy inspiration from existing file sharing systems such as BitTorrent and [ppspp](https://tools.ietf.org/html/rfc7574)

## Goals

(what are the goals of this spec/network?)

## Overview

(what does it do?)

## Content Integrity

(how does it verify content?)

## Wire Protocol

Hyperdrive peers can communicate over any repliable binary duplex stream using a message oriented wire protocol.

All messages sent are prefixed with a [varint](https://developers.google.com/protocol-buffers/docs/encoding?hl=en#varints)
containing the length of the payload when sent over the wire

```
<varint-length-of-payload><payload>
```

In general payload messages are small and an implementation should make sure to only buffer messages that can easily fit in memory. The javascript implementation currently rejects all messages >5mb.
All messages, except for the first one which is always a handshake, are also prefixed with a varint describing the message type

```
<varint-length-of-payload>(<varint-type><message>)
```

If you receive a message with an unknown type you should ignore it for easier compatibility with future updates to this spec.

The messages are encoded into binary values using [protobuf](https://developers.google.com/protocol-buffers).
A single stream using the wire protocol can be used to share multiple swarms of data using a simple multiplexing scheme that is described below

#### messages.Handshake

The first message sent should always be a handshake message. It is also the only message not prefixed with a type indicator.

The protobuf schema for the message is

``` proto
message Handshake {
  required string protocol = 1;
  optional uint64 version = 2;
  required bytes id = 3;
}
```

`protocol` string should be set to `"hyperdrive"`. This is to allow for early failure incase the other peer is sending garbled data.

`version` should be set to the version of the hyperdrive protocol you are speaking.

`id` should be a short binary id of the peer. The javascript implementation uses a 32 byte random binary value for this.

#### messages.Join

A join message has type `0` and the following schema

``` proto
message Join {
  required uint64 channel = 1;
  required bytes link = 2;
}
```

Should be sent when you are interested in joining a specific swarm of data specified by the `link`.

`channel` should be set to the lowest locally available channel number (starting at `0`) and all subsequent messages sent refering to the same `link` should contain the same channel number. When receiving a Join message, if you wish to join the swarm, you should reply back with a new Join message if you haven't sent one already containing the same link and your lowest locally available channel number.

When having both sent and received a remote Join message for a specific swarm `link` you will have both a local and remote channel number that can be used to separate separate swarm messages from each other and allows for reuse of the same connection stream for multiple swarms. Note that since you only pick you local channel number and a channel has both a local and remote one there are no risk of channel id clashes.

#### messages.Leave

A leave message has type `1` and the following schema

``` proto
message Leave {
  required uint64 channel = 1;
}
```

Should be sent when you are no longer interested in a data swarm and wish to leave a channel.

#### messages.Have

A have message has type `2` and the following schema

``` proto
message Have {
  required uint64 channel = 1;
  repeated uint64 blocks = 2;
  optional bytes bitfield = 3;
}
```

Should be sent to indicate that you have new blocks ready to be requested.

`blocks` can optionally be set to an array of new block indexes you have

`bitfield` can optionally be set to a binary bitfield containing a complete overview of the blocks you have.

#### messages.Choke

A choke message has type `3` and the following schema

``` proto
message Choke {
  required uint64 channel = 1;
}
```

Should be sent if you want to choke a channel.

If you are choking a channel you are indicating to the remote that you wont accept any requests.
All channels should start out choked so you should only send this if you've previously sent an `unchoke` message.

#### messages.Unchoke

An unchoke message has type `4` and the following schema

``` proto
message Unchoke {
  required uint64 channel = 1;
}
```

Should be sent if you want to unchoke a channel.

As mentioned above all channels start out choked so you'll need to send this if you want to allow the remote to start requesting blocks.

#### messages.Request

A request message has type `5` and the following schema

``` proto
message Request {
  required uint64 channel = 1;
  required uint64 block = 2;
}
```

Should be sent if you want to request a new block.

If you receive a request while you are choking a remote you should ignore it.

`block` should be set to the index of the block you want to request.

#### messages.Response

A response message has type `6` and the following schema

``` proto
message Response {
  message Proof {
    required uint64 index = 1;
    required bytes hash = 2;
  }

  required uint64 channel = 1;
  required uint64 block = 2;
  required bytes data = 3;
  repeated Proof proof = 4;
```

Should be sent to respond to a request.

`block` should be set to the index of block you are responding with.

`data` should be set to the binary block

`proof` should be set to the needed integrity proof needed to verify that this block is correct (TODO: WHEN ADDED TO THE SPEC, LINK THAT FROM THERE).

After receiving a verified response message you should send a have messages to other peers you are connected, except for the peer sending you the response, to indicate you now have this piece. If you are the peer sending a response you should record that the remote peer now have this block as well.

#### messages.Cancel

An cancel message has the type `7` and the following schema

``` proto
message Cancel {
  required uint64 channel = 1;
  required uint64 block = 2;
}
```

Should be sent to cancel a previously sent request.

`block` should be set to the same block index as the request you want to cancel.

## Downloading/uploading flow

(a discussion about the download/upload flow)

## Prioritized downloading

(a discussion about prioritized downloading / streaming)

## Peer discovery

(how do you find peers? aka should be handled outside of core but use a dht/tracker)

## File sharing

(how can you use this protocol to share files?)
