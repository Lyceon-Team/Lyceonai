// Registers hooks.mjs (see its header). Used only as `tsx --import ./register.mjs`.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
