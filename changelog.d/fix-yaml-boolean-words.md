- **Fixed**: A YAML value `on`, `off`, `yes` or `no` (any case) was read by the server as a
  boolean, while the editor showed the word: an enum argument `values: [on, off]` became
  `[true, false]`, a translation `Yes` became `true`, and an add-on's lang message `On` was
  dropped. The server now reads every Project and module file as YAML 1.2, like the editor:
  only `true` and `false` are booleans.
