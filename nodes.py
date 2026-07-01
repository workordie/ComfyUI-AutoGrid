"""
ComfyUI-GridSplit nodes.

  AutoGridSplit — detect the seams in a stitched grid/carousel/collage and split
                  it into its individual panels.
  GridStitch    — the inverse: repeat one image into an R x C grid, scaled to a
                  target total megapixels (no distortion; cell aspect = image aspect).

No model, CPU, any resolution.
"""
import torch
import torch.nn.functional as F
from .gridsplit import find_panels, slice_boxes, draw_preview


class AutoGridSplit:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "sensitivity": ("FLOAT", {"default": 1.0, "min": 1.0, "max": 10.0, "step": 0.5,
                                          "tooltip": "Splitting aggressiveness. 1 = standard (recommended). Higher = split more eagerly / catch weaker seams."}),
                "min_panel_px": ("INT", {"default": 64, "min": 8, "max": 8192,
                                         "tooltip": "Reject any split that would make a panel smaller than this."}),
                "edge_trim": ("INT", {"default": 0, "min": 0, "max": 256,
                                      "tooltip": "Shave N px off each interior seam edge (kills blend/halo/leftover gutter)."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "IMAGE")
    RETURN_NAMES = ("panels", "count", "preview")
    OUTPUT_IS_LIST = (True, False, False)   # panels is a list (tiles differ in size); count/preview are scalars
    FUNCTION = "split"
    CATEGORY = "image/grid"

    def split(self, image, sensitivity, min_panel_px, edge_trim):
        panels_out = []
        preview = image[0:1]
        for b in range(image.shape[0]):
            img = image[b]  # [H,W,C]
            boxes = find_panels(img, sensitivity=sensitivity, min_panel=min_panel_px)
            tiles = slice_boxes(img, boxes, edge_trim)
            panels_out.extend(t.unsqueeze(0) for t in tiles)
            if b == 0:
                preview = draw_preview(img, boxes).unsqueeze(0)

        if not panels_out:                       # nothing detected -> pass the image through unchanged
            panels_out = [image[0:1]]
        return (panels_out, len(panels_out), preview)


class GridStitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "rows": ("INT", {"default": 3, "min": 1, "max": 32}),
                "cols": ("INT", {"default": 3, "min": 1, "max": 32}),
                "megapixels": ("FLOAT", {"default": 4.0, "min": 0.1, "max": 100.0, "step": 0.1,
                                         "tooltip": "Target TOTAL size of the stitched grid, in megapixels."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("grid", "width", "height")
    FUNCTION = "stitch"
    CATEGORY = "image/grid"

    def stitch(self, image, rows, cols, megapixels):
        B, H, W, C = image.shape
        aspect = W / H
        target_px = max(1.0, megapixels * 1_000_000.0)
        # aspect-preserving cell whose rows*cols copies tile to ~target_px
        h_c = max(1, int(round((target_px / (rows * cols * aspect)) ** 0.5)))
        w_c = max(1, int(round(aspect * h_c)))
        # resize every input image to the cell size (antialiased for clean down-scaling)
        chw = image.permute(0, 3, 1, 2)
        resized = F.interpolate(chw, size=(h_c, w_c), mode="bicubic",
                                antialias=True, align_corners=False).clamp(0.0, 1.0)
        resized = resized.permute(0, 2, 3, 1)
        out = torch.empty(1, rows * h_c, cols * w_c, C, dtype=image.dtype, device=image.device)
        for r in range(rows):
            for c in range(cols):
                idx = (r * cols + c) % B          # batch=1 -> repeat; batch>1 -> fill cells cyclically
                out[0, r * h_c:(r + 1) * h_c, c * w_c:(c + 1) * w_c, :] = resized[idx]
        return (out, cols * w_c, rows * h_c)


NODE_CLASS_MAPPINGS = {
    "AutoGridSplit": AutoGridSplit,
    "GridStitch": GridStitch,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AutoGridSplit": "Auto Grid / Carousel Split",
    "GridStitch": "Grid Stitch (repeat → grid)",
}
