import { useState } from "react";
import { BasketIcon } from "./icons";

/** Small "+ Basket" button: `add` gathers the item and puts it in the study basket. */
export function BasketButton({ add, title = "Add to the study basket (gather material for a study sheet)" }: { add: () => Promise<boolean>; title?: string }) {
  const [done, setDone] = useState<null | boolean>(null);
  return (
    <button
      className="text-btn answer-copy basket-btn"
      title={title}
      onClick={async (e) => {
        e.stopPropagation();
        setDone(await add());
        window.setTimeout(() => setDone(null), 1500);
      }}
    >
      <BasketIcon size={13} /> {done === null ? "Basket" : done ? "Added" : "Couldn't add"}
    </button>
  );
}
