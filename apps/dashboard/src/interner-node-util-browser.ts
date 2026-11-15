const isFalse = (): boolean => false

export const types = {
  isArgumentsObject: isFalse,
  isAnyArrayBuffer: isFalse,
  isArrayBufferView: isFalse,
  isBoxedPrimitive: isFalse,
  isCryptoKey: isFalse,
  isExternal: isFalse,
  isKeyObject: isFalse,
  isMap: isFalse,
  isMapIterator: isFalse,
  isModuleNamespaceObject: isFalse,
  isNativeError: isFalse,
  isPromise: isFalse,
  isSet: isFalse,
  isSetIterator: isFalse,
  isSharedArrayBuffer: isFalse,
  isWeakMap: isFalse,
  isWeakSet: isFalse,
  isDate: (value: unknown): value is Date => value instanceof Date,
  isRegExp: (value: unknown): value is RegExp => value instanceof RegExp,
}
