import { Kernels } from "./model.js";
import { getKernelUpstream } from "./kernel-registry.js";

const schemas = Object.freeze({
  [Kernels.MIHOMO]: Object.freeze({
    version: getKernelUpstream(Kernels.MIHOMO).stable,
    schemaId: "mihomo.config.v1",
    root: Object.freeze({ requiredAnyOf: Object.freeze([{ key: "proxies", type: "array" }, { key: "proxy-providers", type: "object" }]) }),
    nodeCollection: "proxies"
  }),
  [Kernels.SING_BOX]: Object.freeze({
    version: getKernelUpstream(Kernels.SING_BOX).stable,
    schemaId: "sing-box.config.v1",
    root: Object.freeze({ required: ["outbounds"] }),
    nodeCollection: "outbounds"
  }),
  [Kernels.XRAY]: Object.freeze({
    version: getKernelUpstream(Kernels.XRAY).stable,
    schemaId: "xray.config.v1",
    root: Object.freeze({ required: ["outbounds"] }),
    nodeCollection: "outbounds"
  })
});

export function getKernelSchema(kernel, version = getKernelUpstream(kernel).stable) {
  const schema = schemas[kernel];
  if (!schema) throw new Error("unsupported kernel: " + kernel);
  if (schema.version !== version) {
    throw new Error("no maintained schema for " + kernel + " " + version + "; maintained baseline is " + schema.version);
  }
  return Object.freeze({ kernel, ...schema });
}

export function listKernelSchemas() {
  return Object.freeze(Object.entries(schemas).map(([kernel, schema]) => Object.freeze({
    kernel,
    version: schema.version,
    schemaId: schema.schemaId
  })));
}
