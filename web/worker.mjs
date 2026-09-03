import { analyze } from "./model.mjs";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: analyze(data.p, data.rows) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
