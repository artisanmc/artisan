- **Added**: A menu button can name a component: a list of parts written once in a file of
  the module's `components/` folder, with parameters (a text, an image), which every button
  that names it draws (`component: { name: confirm, text: "Buy" }`). Changing the component
  changes all of them. A component can belong to a module or be common to the server (the
  theme `artisan`). The editor keeps a button's component as written and draws it on the
  canvas.
  In the editor, the **Component** section of a button's properties chooses a component,
  fills its parameters, detaches it, and saves a button's own parts as a new component.
  A module's Resources list its components (**Components**): each opens alone, shown as a
  menu draws it, with its parameters, its parts and the buttons that name it.
- **Fixed**: A button made of several texts could show one of them twice or not at all on
  the editor's canvas.
