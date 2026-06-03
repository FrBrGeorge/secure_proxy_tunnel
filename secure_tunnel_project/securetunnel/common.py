import os
import random
import asyncio

def pad_data(data: bytes, padding_amount: int) -> bytes:
    """
    Pads bytes with an approximate amount of random data.
    Uses the format:
    [msg_len (4 bytes)][pad_len (4 bytes)][original_data][random_padding]
    """
    if padding_amount < 0:
        padding_amount = 0
    
    # Choose random padding length up to 2 * padding_amount to average around padding_amount
    pad_len = random.randint(0, padding_amount * 2) if padding_amount > 0 else 0
    pad_bytes = os.urandom(pad_len)
    
    msg_len = len(data)
    header = msg_len.to_bytes(4, 'big') + pad_len.to_bytes(4, 'big')
    return header + data + pad_bytes

async def read_padded_data(reader: asyncio.StreamReader) -> bytes:
    """
    Reads padded data from a StreamReader and returns the unpadded original bytes.
    If EOF is reached or transmission is malformed, returns an empty bytes object.
    """
    try:
        header = await reader.readexactly(8)
    except asyncio.IncompleteReadError:
        return b""
        
    msg_len = int.from_bytes(header[:4], 'big')
    pad_len = int.from_bytes(header[4:], 'big')
    
    total_payload_len = msg_len + pad_len
    try:
        payload = await reader.readexactly(total_payload_len)
    except asyncio.IncompleteReadError:
        return b""
        
    return payload[:msg_len]
