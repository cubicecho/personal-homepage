/** The served schema's SDL. Every field carries a description: it is the API's documentation. */
export const TYPE_DEFS = /* GraphQL */ `
  "What an item on a page is, and so how it opens."
  enum ItemKind {
    "A tile that opens the URL in a new browser tab."
    LINK
    "The URL framed inline on the page, at frameHeightPx."
    FRAME
    "A tile that opens the URL framed across the whole content area."
    APP
  }

  "The glyphs a page or item may wear."
  enum Icon {
    GLOBE
    SERVER
    HOUSE
    FILM
    MUSIC
    IMAGE
    BOOK
    DATABASE
    CHART
    CLOUD
    SHIELD
    TERMINAL
    CODE
    CALENDAR
    MAIL
    DOWNLOAD
    GAMEPAD
    KANBAN
    CAMERA
    ROUTER
    PRINTER
    SETTINGS
  }

  "One thing on a page: a link tile, an inline frame, or an app tile."
  type Item {
    "Unique within its page."
    id: ID!
    kind: ItemKind!
    title: String!
    "An absolute http or https URL."
    url: String!
    icon: Icon
    description: String
    "Height of the inline frame, in CSS pixels. Set for FRAME items only."
    frameHeightPx: Int
  }

  "A page: a title and its items, in order."
  type Page {
    "Unique; the page's URL segment."
    slug: ID!
    title: String!
    icon: Icon
    "Whether this is the home page, which is always first and cannot be deleted or moved."
    isHome: Boolean!
    items: [Item!]!
  }

  "How big pages and items may get. The web forms check the same numbers the server does."
  type PageLimits {
    maxPages: Int!
    maxItemsPerPage: Int!
    maxTitleLength: Int!
    maxDescriptionLength: Int!
    maxUrlLength: Int!
    maxSlugLength: Int!
    minFrameHeightPx: Int!
    maxFrameHeightPx: Int!
    defaultFrameHeightPx: Int!
  }

  type Query {
    "Every page, home first."
    pages: [Page!]!
    "One page. NOT_FOUND when no page has the slug."
    page(slug: ID!): Page!
    "The limits every write is checked against."
    pageLimits: PageLimits!
  }

  "A new page."
  input CreatePageInput {
    title: String!
    "Lower-case letters, digits and single hyphens. Made from the title when left out."
    slug: String
    icon: Icon
  }

  "What to change on a page. A field left out is kept; icon: null clears the icon."
  input UpdatePageInput {
    title: String
    icon: Icon
  }

  "An item's fields, for adding one or replacing one's."
  input ItemInput {
    kind: ItemKind!
    title: String!
    "An absolute http or https URL."
    url: String!
    icon: Icon
    description: String
    "FRAME only, in CSS pixels; PageLimits.defaultFrameHeightPx when left out. Ignored for other kinds."
    frameHeightPx: Int
  }

  type Mutation {
    "Adds a page at the end of the list."
    createPage(input: CreatePageInput!): Page!
    "Changes a page's title or icon."
    updatePage(slug: ID!, input: UpdatePageInput!): Page!
    "Deletes a page and its items, and returns its slug. The home page cannot be deleted."
    deletePage(slug: ID!): ID!
    "Moves a page within the list and returns every page. Home stays first."
    movePage(slug: ID!, toIndex: Int!): [Page!]!
    "Adds an item at the end of a page and returns the page."
    addItem(pageSlug: ID!, input: ItemInput!): Page!
    "Replaces an item's fields and returns the page."
    updateItem(pageSlug: ID!, id: ID!, input: ItemInput!): Page!
    "Removes an item and returns the page."
    removeItem(pageSlug: ID!, id: ID!): Page!
    "Moves an item within its page and returns the page."
    moveItem(pageSlug: ID!, id: ID!, toIndex: Int!): Page!
  }
`;
