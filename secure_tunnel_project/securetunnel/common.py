import os
import random
import asyncio

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
