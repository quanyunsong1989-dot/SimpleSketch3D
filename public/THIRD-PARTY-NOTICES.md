# Third-party notices

SimpleSketch 3D includes or uses the following software. Their full license texts are in the `licenses` folder of the release.

| Component | Use | License |
| --- | --- | --- |
| [three.js](https://threejs.org) r170 | 3D rendering, file loaders and exporters (bundled in `app/lib`) | MIT, Copyright © 2010-2024 three.js authors |
| [Electron](https://www.electronjs.org) 33 | Desktop app runtime | MIT, Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc. |
| Chromium and its dependencies | Part of Electron | Various, see `LICENSES.chromium.html` |
| [three.js](https://threejs.org) r187 | Render window (WebGPU renderer, bundled in `app/lib/rt/three`) | MIT, Copyright © 2010-2026 three.js authors |
| [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) 0.0.28 | Render window: path tracing (`app/lib/rt/three-gpu-pathtracer`) | MIT, Copyright (c) 2021 Garrett Johnson |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.9.18 | Render window: ray acceleration (`app/lib/rt/three-mesh-bvh`) | MIT, Copyright (c) 2018 Garrett Johnson |
| [oidn-webgpu](https://github.com/pissang/oidn-web) 0.6.0 | Render window: denoising (`app/lib/rt/oidn/oidn.js`) | MIT, Copyright (c) 2024 pissang |
| [Intel Open Image Denoise](https://www.openimagedenoise.org) weights (`rt_hdr_alb_nrm.tza`, from oidn-weights 2.3.0) | Render window: denoising network | Apache License 2.0, Copyright Intel Corporation |

## SketchUp (.skp) support
This version does **not** include or use the Trimble SketchUp SDK. `.skp` open/save is planned for a later update, once Trimble has approved the use of the SDK.

SketchUp is a trademark of Trimble Inc. SimpleSketch 3D is an independent project and is not affiliated with or endorsed by Trimble.
