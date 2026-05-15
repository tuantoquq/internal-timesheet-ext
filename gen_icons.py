#!/usr/bin/env python3
"""Generate simple placeholder PNG icons for the Chrome extension."""
import struct, zlib, os

def create_png(size, color=(91, 110, 245)):
    """Create a minimal valid PNG with a solid color background and a white checkmark."""
    # Simple solid-color PNG generation
    width = height = size
    r, g, b = color
    
    # Create pixel data (RGBA)
    pixels = []
    for y in range(height):
        row = []
        for x in range(width):
            # Background
            bg_r, bg_g, bg_b = r, g, b
            
            # Draw a simple checkmark shape
            cx, cy = x / width, y / height
            
            # Circle mask
            dx, dy = cx - 0.5, cy - 0.5
            in_circle = (dx*dx + dy*dy) < 0.2
            
            if in_circle:
                # Check mark path (approximate)
                # Left leg: from (0.28,0.5) to (0.42,0.65)
                # Right leg: from (0.42,0.65) to (0.72,0.32)
                on_mark = False
                lw = 0.06  # line width
                
                # Left part of check
                if 0.25 < cx < 0.48 and 0.42 < cy < 0.70:
                    # Line from (0.28,0.48) to (0.42,0.65)
                    t = (cx - 0.28) / (0.42 - 0.28)
                    expected_y = 0.48 + t * (0.65 - 0.48)
                    if abs(cy - expected_y) < lw and 0 <= t <= 1:
                        on_mark = True
                
                # Right part of check
                if 0.40 < cx < 0.75 and 0.28 < cy < 0.68:
                    t = (cx - 0.42) / (0.72 - 0.42)
                    expected_y = 0.65 - t * (0.65 - 0.30)
                    if abs(cy - expected_y) < lw and 0 <= t <= 1:
                        on_mark = True
                
                if on_mark:
                    row.extend([255, 255, 255, 255])  # white
                else:
                    row.extend([bg_r, bg_g, bg_b, 255])  # accent color
            else:
                row.extend([0, 0, 0, 0])  # transparent outside circle
        pixels.append(bytes(row))
    
    def make_chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    # PNG header
    png_sig = b'\x89PNG\r\n\x1a\n'
    
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)
    
    # IDAT
    raw = b''
    for row in pixels:
        raw += b'\x00' + row  # filter type 0 (None)
    compressed = zlib.compress(raw, 9)
    idat = make_chunk(b'IDAT', compressed)
    
    # IEND
    iend = make_chunk(b'IEND', b'')
    
    return png_sig + ihdr + idat + iend

os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    data = create_png(size)
    with open(f'icons/icon{size}.png', 'wb') as f:
        f.write(data)
    print(f'Created icons/icon{size}.png ({len(data)} bytes)')

print('Done!')
