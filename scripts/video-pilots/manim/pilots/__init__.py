"""Video pilots (Manim): one module per question, named by its id, each with run(scene).

@spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D1: "each pilot is a small scene
      module or a per-question config"] | @implemented [2026-11-02]

plain English: scene.py's WorkedExample loads pilots/<question id>.py and calls its run(scene)
between the open card and the end; the module draws that question's figure and plays its lines.
"""
