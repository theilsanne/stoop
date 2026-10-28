// Turns a picked photo into a profile picture: a centered square, shrunk, as a JPEG.
// It's done here, on the phone, so a full-size photo never has to be uploaded.

const SIZE = 512;

export async function squareAvatar(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // respects the photo's rotation
  } catch {
    throw new Error("That photo couldn't be opened. Try a JPEG or PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("That photo couldn't be saved. Try another one.");
  return blob;
}
