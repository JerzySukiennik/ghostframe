# Ghostframe

A web toy for posing Tesla Optimus. Place translucent ghosts of the robot around the stage, pose each one, and the app generates every in-between frame: smooth spline interpolation, a procedural walk with planted footsteps when ghosts stand apart, and an anticipation-flight-landing jump.

- Grab any body part and pull it (hand and forearm: arm IK, upper arm and thigh: swing, shin and foot: leg IK, head: look, torso: bend, hips: crouch with feet planted). The moved limb lights up.
- Click a part for precise rotation rings. Drag the ring under a ghost to move it, the arrow to turn it.
- Timeline: click a transition to pick Auto / Walk / Smooth / Jump and its duration. "Klatki" shows the generated frames as an onion skin.

Stack: three.js 0.170 from CDN, ES modules, no build. The robot is fully procedural (lofted superellipse shells, rigid skinning, 49 bones).

Run locally: `python3 -m http.server 8871` in this folder, then open http://localhost:8871.
