import ReactDOM from "react-dom/client";
import { App } from "./App";
import { loadExtraPages } from "./extraPages";
import "./styles.css";

// the additional stories fetched earlier (if any) join the lists as soon as they are read; the lists draw again when they do
void loadExtraPages();

// (not in StrictMode: its repeated effects would add and remove Back-button steps)
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
