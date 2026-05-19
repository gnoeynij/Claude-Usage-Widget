/* @refresh reload */
import { render } from "solid-js/web";
import "virtual:uno.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/glass.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

render(() => <App />, root);
