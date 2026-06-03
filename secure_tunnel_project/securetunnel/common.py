import os
import random
import asyncio

# STMP Multiplexed Protocol Command Constants
CMD_CONNECT = 1
CMD_CONNECT_OK = 2
CMD_CONNECT_FAIL = 3
CMD_DATA = 4
CMD_CLOSE = 5
CMD_KEEPALIVE = 6

class STMPConnection:
    def __init__(self, writer: asyncio.StreamWriter):
        self.writer = writer
        self.lock = asyncio.Lock()

    async def write_frame(self, stream_id: int, cmd: int, payload: bytes = b""):
        async with self.lock:
            try:
                payload_len = len(payload)
                header = stream_id.to_bytes(4, 'big') + bytes([cmd]) + payload_len.to_bytes(4, 'big')
                self.writer.write(header + payload)
                await self.writer.drain()
            except Exception:
                pass

    async def close(self):
        async with self.lock:
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception:
                pass

async def read_stmp_frame(reader: asyncio.StreamReader):
    """
    Reads a single STMP frame: header (9 bytes) + payload.
    Returns (stream_id, cmd, payload) or None if EOF or error.
    """
    try:
        header = await reader.readexactly(9)
    except Exception:
        return None
    
    stream_id = int.from_bytes(header[0:4], 'big')
    cmd = header[4]
    payload_len = int.from_bytes(header[5:9], 'big')
    
    try:
        if payload_len > 0:
            payload = await reader.readexactly(payload_len)
        else:
            payload = b""
    except Exception:
        return None
        
    return stream_id, cmd, payload

def pad_data(data: bytes, padding_amount: int = 64) -> bytes:
    """
    Pads bytes with an approximate amount of random data.
    Uses the format:
    [msg_len (2 bytes)][pad_len (2 bytes)][original_data][random_padding]
    """
    if padding_amount < 0:
        padding_amount = 0
    
    msg_len = len(data)
    if msg_len > 1024:
        pad_len = 0
    else:
        # Choose random padding length up to 2 * padding_amount to average around padding_amount
        pad_len = random.randint(0, padding_amount * 2) if padding_amount > 0 else 0
    pad_bytes = os.urandom(pad_len) if pad_len > 0 else b""
    
    header = msg_len.to_bytes(2, 'big') + pad_len.to_bytes(2, 'big')
    return header + data + pad_bytes

async def read_padded_data(reader: asyncio.StreamReader) -> bytes:
    """
    Reads padded data from a StreamReader and returns the unpadded original bytes.
    If EOF is reached or transmission is malformed, returns an empty bytes object.
    """
    try:
        header = await reader.readexactly(4)
    except asyncio.IncompleteReadError:
        return b""
        
    msg_len = int.from_bytes(header[:2], 'big')
    pad_len = int.from_bytes(header[2:], 'big')
    
    total_payload_len = msg_len + pad_len
    try:
        payload = await reader.readexactly(total_payload_len)
    except asyncio.IncompleteReadError:
        return b""
        
    return payload[:msg_len]
