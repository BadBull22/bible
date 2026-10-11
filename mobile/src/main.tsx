import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// (not in StrictMode: its repeated effects would add and remove Back-button steps)
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
