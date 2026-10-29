# How It's Made: your phone photo

A scroll-driven explainer of how a phone camera turns light into the photo in your gallery. Every stage is computed live from your own selfie or laptop camera (or a generated sample scene) on the GPU, and the animation is tied to scroll: scroll forward to play, stop to freeze, scroll back to rewind.

## The 12 scenes

| # | Stage | What you see live |
| --- | --- | --- |
| 1 | Lens and autofocus | Rays converging through the lens stack; the picture racks into focus |
| 2 | IR-cut filter and OIS | Infrared cast removed; hand shake cancelled by the stabiliser |
| 3 | Photosites | Zoom into individual microlens wells filling with light |
| 4 | Bayer filter | Your frame as the red/green/blue mosaic the sensor really records |
| 5 | Readout and ADC | Rolling row-by-row readout, then real 10-bit values from your frame |
| 6 | MIPI CSI-2 | Packets of real RAW10 bytes travelling over four lanes; I²C control going back |
| 7 | ISP clean-up | Black level, lens shading, hot-pixel and noise correction, one at a time |
| 8 | Demosaic | Missing colours interpolated; the green, flat raw colour appears |
| 9 | Colour | White balance, colour matrix, tone curve, sharpening |
| 10 | Multi-frame | Low-light noise, then a burst of frames averaged (before/after split) |
| 11 | JPEG and storage | Y/Cb/Cr planes, 8×8 DCT blocks, quantisation, real encoded file size, EXIF |
| 12 | Display | The photo in a gallery, then down to the screen's RGB subpixels |

## How it works

- **anime.js v4** builds one timeline per pinned section. The render loop seeks each timeline to its scroll position with frame-rate-independent easing, so motion stays smooth and exactly reversible.
- **WebGL2** runs a small ISP as a chain of fragment shaders (`src/gl/shaders.js`): raw simulation, clean-up, bilinear demosaic, colour, sharpening, frame stacking, and a real forward/inverse 8×8 DCT with libjpeg quantisation tables.
- **A caveat:** browsers never expose true sensor data, because the camera feed has already been processed by the device. The page undoes that processing (inverse gamma, re-applied Bayer mosaic, lens shading, black level, hot pixels, photon and read noise) to rebuild a realistic raw frame, then runs its own pipeline forward. The page says so too.
- Nothing is uploaded. The camera needs HTTPS (or `localhost`).

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

To test on a phone, open the dev server's network URL over HTTPS, or deploy.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions** once.
