const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bear", {
  onPath: (fn) => ipcRenderer.on("sb:preview-path", (e, p) => fn(p)),
  load: (path) => ipcRenderer.invoke("sb:preview-data", path),
  edit: (path) => ipcRenderer.invoke("sb:preview-edit", path),
  save: (path) => ipcRenderer.invoke("sb:preview-save", path),
  close: () => ipcRenderer.invoke("sb:preview-close"),
  openExternal: (url) => ipcRenderer.invoke("sb:open-external", url),
});
