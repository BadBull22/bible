import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ReviewAnswer, STORE_PAGE } from "../reviewAsk";
import { CloseIcon } from "./icons";

interface Props {
  onAnswer: (answer: ReviewAnswer) => void;
}

/**
 * A short, polite request to review the app on the Microsoft Store (the same look as the What's new window). "Write a review" opens the app's
 * Store page, where the reader can leave a rating and a review; "Maybe later" asks again in a month; "Don't ask again" ends the requests.
 * Closing the window (the cross, or Escape) counts as "Maybe later". The words are the same for everyone, as the Store requires.
 */
export function ReviewPrompt({ onAnswer }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onAnswer("later");
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onAnswer]);

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div className="welcome-window review-window">
        <div className="welcome-head">
          <h2 id="review-title">Would you leave a review?</h2>
          <button className="icon-btn welcome-close" onClick={() => onAnswer("later")} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <p className="review-text">
          If Bible Concordance has helped your Bible study, a short rating and review on the Microsoft Store helps other people find it. It only takes a
          minute, and it is entirely up to you.
        </p>
        <div className="review-actions">
          <button
            className="pill-btn"
            onClick={() => {
              void openUrl(STORE_PAGE).catch(() => undefined);
              onAnswer("review");
            }}
            title="Opens the app's page in the Microsoft Store, where you can write your review"
          >
            Write a review
          </button>
          <button className="outline-btn" onClick={() => onAnswer("later")}>
            Maybe later
          </button>
          <button className="link-btn review-never" onClick={() => onAnswer("never")}>
            Don't ask again
          </button>
        </div>
      </div>
    </div>
  );
}
