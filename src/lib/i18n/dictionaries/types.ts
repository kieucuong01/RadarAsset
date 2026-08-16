export type DictionaryShape<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Record<string, unknown>
      ? DictionaryShape<T[K]>
      : never;
};
