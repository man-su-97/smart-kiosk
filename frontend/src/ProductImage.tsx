import { useState } from "react";
import { ProductIcon } from "./ProductIcon";

// The product's photo if it has one (and it loads); otherwise the built-in drawing.
export function ProductImage({ name, imageUrl, className = "size-10" }: { name: string; imageUrl: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (imageUrl && !broken) {
    return <img src={imageUrl} alt={name} onError={() => setBroken(true)} className={`${className} rounded-xl object-cover`} />;
  }
  return <ProductIcon name={name} className={className} />;
}
