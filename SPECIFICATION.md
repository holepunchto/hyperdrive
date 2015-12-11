# Hyperdrive Specification

Mathias Buus (@mafintosh). December 10th, 2015.

## DRAFT Version 0

A design and specification document for Hyperdrive. Hyperdrive is a protocol and network for distributing and replicating static feeds of binary data.
The protocol itself draws heavy inspiration from existing file sharing systems such as BitTorrent and [ppspp](https://tools.ietf.org/html/rfc7574)

## Goals

The goals of hyperdrive is to distribute static feeds of binary data to a swarm of peers in an as efficient as possible way.
It uses merkle trees to verify and deduplicate content so that if you share the same file twice it'll only have to downloaded one time. Merkle trees also allows for partial deduplication so if you make changes to a file only the changes and a small overhead of data will have to be replicated.

One of the core goals is to be as simple and pragmatic as possible. This also allows for easier implementations of client which is often overlooked when implementing distributed systems.

It also tries to be modular and export responsibilities to external modules whenever possible. Peer discovery is a good example of this as this is handled by 3rd party modules that wasn't written with hyperdrive in mind. This allows for a much smaller core implementation that can focus on smaller problems.

Prioritized synchronization of parts of a feed is also at the heart of hyperdrive as this allows for fast streaming with low latency of data such as structued datasets (wikipedia, genome data), linux containers, audio, videos, and much more. To allow for low latency streaming another goal is also to keep verifiable block sizes as small as possible - even with huge data feeds. This is also a main goal of the [dat](https://dat-data.com) project which aims to use hyperdrive as it's main distributing protocol.

## Overview

As mentioned above hyperdrive distributes static feeds of binary data. A static feed is a series of related blocks of binary data that are identified by an incrementing number starting at 0.

```
// a feed with n blocks
block #0, block #1, block #3, block #4, ..., block #n
```

These blocks can be of any reasonable size (strictly speaking they just have to fit in memory but implementations can choose to limit the max size to a more manageble number) and they don't all have to be the same fixed size. A static feed is identified by a hash of the roots of the the merkle trees it spans which means that a feed id (or link) is uniquely identified by it's content. See the "Content Integrity" section for a description on how these merkle trees are generated and the feed id is calcuated.

## Content Integrity

Given a feed with `n` blocks we can generate a series of merkle trees that guarantee the integrity of our feed when distributing it to untrusted peers.

For every block, hash it with a cryptographic hash function (draft 0 uses sha256), prefixed with the type identifier `0` to indicate that this is a block hash.

Using [node.js](https://nodejs.org) this would look like this

``` js
var blockHash = crypto.createHash('sha256')
  .update(new Buffer([0]))
  .update(blockBuffer)
  .digest()
```

Hyperdrive uses a [flat-tree](https://github.com/mafintosh/flat-tree) to represent a tree structure as a flat list.

```
// a flat tree representing six blocks (the even numbers)
// and two roots, 3 and 9

      3
  1       5       9
0   2   4   6   8  10
```

This means that every block hash will be identified by `2 * blockIndex` in the flat tree structure as they are bottom nodes. Every odd numbered index is the parent of two children. In the above example `1` would be the parent of `0` and `2`, `5` would be parent of `4` and `6`, and `3` would be the parent of `1` and `5`. Note that `7` cannot be resolved as it would require `12` and `14` be be present as well.

To calcuate the value of a parent node (odd numbered) we need to hash the values of the left and right child prefixed with the type identifier `1`.

Using [node.js](https://nodejs.org) this would look like this

``` js
var parentHash = crypto.createHash('sha256')
  .update(new Buffer([1]))
  .update(leftChild)
  .update(rightChild)
  .digest()
```

The type prefixing is to make sure a parent hash cannot pretend to be a block hash.

Unless the feed contains a strict power of 2 number of blocks we will end up with more than 1 root hashes when we are building this data structure.
To turn these hashes into the feed id simply do the following. Hash all the roots prefixed with the type identifier `2`, left to right, with the hash values and a uint64 big endian representation of the parent index.

Using [node.js](https://nodejs.org) this would look like this

``` js
var uint64be = require('uint64be') // available on npm
var feedId = crypto.createHash('sha256')
  .update(new Buffer([2]))

for (var i = 0; i < roots.length; i++) {
  feedId.update(roots[i].hash)
  feedId.update(uint64be.encode(roots[i].index))
}

feedId = feedId.digest()
```

Note that the amounts of roots is always `<= log2(number-of-blocks)` and that the total amount of hashes needed to construct the merkle trees is `2 * number-of-blocks`.

By trusting the feed id we can use that to verify the roots of the merkle trees given to us by an untrusted peer by trying to reproduce the same feed id using the above algorithm. When verifing we should also check that the root indexes corresponds to neighbouring merkle trees (see flat-tree/fullRoots for a way to get this list of indexes when verifying). For this reason the first response sent to a remote request should always contain the root hashes and indexes if the remote peer does't have any blocks yet. See the response message in the "Wire Protocol" section for more information.

The index of the left most block in the last merkle tree also tells us how many blocks that are in the feed which is useful if we want to show a progress bar or similar when downloading a feed (see flat-tree/rightSpan for more info on how to calcute this).

Assuming we have verified the root hashes the remote only needs to send us the first "sibling" and all "uncle" hashes from the block index we are requesting to a valid root for us verify the block.

For example, using the above example feed with 6 blocks, assuming we have already verified the root at index 3, if we wanted to verify block #2 (tree index 4) we would need the following hashes

```
// we need 6, the sibling and 1, the uncle

        3
  (1)       5
0     2   4   (6)
```

We also need the content for block #2 of course. Given these values we can verify the block by doing the following

``` js
var block4 = blockHash(block #2)
var parent5 = parentHash(block4, block6)
var parent3 = parentHash(parent1, parent5)
```

If parent3 is equal to the root at tree index 3 (that we already trust) we now know block #2 was correct and we can safely store it and share it with other peers.

If we had received the hash for tree index 5 before and verified it then we would not need to re-verify the root and we would be able to insert block #2 after validating parent5.

It should be noted that this allows us to have random access to any block in the feed with content verification in a single round trip

As an optimization we can use the remote's "have" messages (see the "Wire Protocol" section) to figure out which hashes it already has. For example if the remote has block #3 then we do not need to send any hashes since it will already have verified hash 6 and 5.

## Deduplication

(how does it deduplicate?)

## Wire Protocol

Hyperdrive peers can communicate over any reliable binary duplex stream using a message oriented wire protocol.

All messages sent are prefixed with a [varint](https://developers.google.com/protocol-buffers/docs/encoding?hl=en#varints) containing the length of the payload when sent over the wire

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
}
```

Should be sent to respond to a request.

`block` should be set to the index of block you are responding with.

`data` should be set to the binary block

`proof` should be set to the needed integrity proof needed to verify that this block is correct. The proof should contain the first sibling and uncles hashes and indexes needed to verify this block. If this is the first response the remote is gonna receive (they has sent no have message, or the bitfield was empty) you should include the merkle tree roots and the end of the proof. See the "Content Integrity" section for more information.

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

## Downloading / uploading flow

(a discussion about the download/upload flow)

## Prioritized downloading

(a discussion about prioritized downloading / streaming)

## Peer discovery

(how do you find peers? aka should be handled outside of core but use a dht/tracker)

## File sharing

(how can you use this protocol to share files?)

## Comparison to BitTorrent

(how is this different?)
