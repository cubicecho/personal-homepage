/** The served schema's SDL. Every field carries a description: it is the API's documentation. */
export const TYPE_DEFS = /* GraphQL */ `
  "What an item on a page is."
  enum ItemKind {
    "A tile that opens the URL; opensIn says where."
    LINK
    "The URL framed inline on the page, at frameHeightPx."
    FRAME
  }

  "Where a link opens."
  enum OpensIn {
    "A new browser tab."
    NEW_TAB
    "This tab, leaving the homepage."
    SAME_TAB
    "Framed across the homepage's content area, with Open in the browser beside it."
    APP
  }

  """
  One thing on a page: a link tile or an inline frame.

  icon is a reference: a built-in glyph name (film), di:<name> (dashboard-icons), sh:<name> (selfh.st icons),
  favicon (the site's own, fetched by the server), or an image URL. iconUrl is where the browser loads it from,
  null for a built-in glyph or no icon.
  """
  type Item {
    "Unique within its page, across its sections."
    id: ID!
    kind: ItemKind!
    title: String!
    "An absolute http or https URL."
    url: String!
    "Where a LINK opens. Null for a FRAME."
    opensIn: OpensIn
    icon: String
    "Where the browser loads the icon image from. Null for a built-in glyph or no icon."
    iconUrl: String
    description: String
    "Height of the inline frame, in CSS pixels. Set for FRAME items only."
    frameHeightPx: Int
    "Whether the server checks this item's status."
    checkEnabled: Boolean!
    "The URL checked instead of url, such as an internal health endpoint. Null checks url."
    checkUrl: String
  }

  "A group of items on a page, with an optional heading."
  type Section {
    "Unique within its page."
    id: ID!
    "The heading. Null draws the items with no heading."
    title: String
    "Whether it starts folded. A browser remembers its own choice after that."
    collapsed: Boolean!
    items: [Item!]!
  }

  "A page: a title and its sections, in order."
  type Page {
    "Unique; the page's URL segment."
    slug: ID!
    title: String!
    "An icon reference, as on Item. Pages can't use favicon."
    icon: String
    "Where the browser loads the icon image from. Null for a built-in glyph or no icon."
    iconUrl: String
    "Whether this is the home page, which is always first and cannot be deleted or moved."
    isHome: Boolean!
    "At least one."
    sections: [Section!]!
    "Every item, first section first: the sections flattened."
    items: [Item!]!
  }

  "How big pages and items may get. The web forms check the same numbers the server does."
  type PageLimits {
    maxPages: Int!
    maxItemsPerPage: Int!
    maxSectionsPerPage: Int!
    maxTitleLength: Int!
    maxDescriptionLength: Int!
    maxUrlLength: Int!
    maxSlugLength: Int!
    minFrameHeightPx: Int!
    maxFrameHeightPx: Int!
    defaultFrameHeightPx: Int!
  }

  "How an item's last check went."
  enum StatusState {
    "It answered with a success, a redirect, or an auth challenge (401, 403)."
    UP
    "It did not answer in time, or answered with an error."
    DOWN
    "Not checked yet, or checking is off."
    UNKNOWN
  }

  "One item's status, from the server's last check of it."
  type ItemStatus {
    itemId: ID!
    state: StatusState!
    "The HTTP status it answered with, when it answered."
    httpStatus: Int
    "How long it took to answer, in milliseconds."
    latencyMs: Int
    "When it was checked, as an ISO 8601 time."
    checkedAt: String
    "Why it is down, in a sentence."
    message: String
  }

  "Whether a site lets other sites show it in a frame."
  type FrameCheck {
    url: String!
    "True when nothing forbids framing, false when X-Frame-Options or a frame-ancestors policy does, null when the site could not be reached."
    framable: Boolean
    "What decided it, in a sentence."
    reason: String
  }

  "Where an icon in a search result comes from."
  enum IconSource {
    "A glyph the web app draws itself."
    GLYPH
    "homarr-labs/dashboard-icons."
    DASHBOARD_ICONS
    "selfh.st/icons."
    SELFHST
  }

  "One icon a search found."
  type IconOption {
    "The reference to store in icon."
    ref: String!
    label: String!
    source: IconSource!
    "Where the browser loads it from. Null for a glyph."
    url: String
  }

  "A web search the launcher can send a query to."
  type SearchEngine {
    "What a query starts with to pick it, such as g for !g."
    prefix: String!
    name: String!
    "The search address, with {query} where the query goes."
    url: String!
    "Whether a query with no prefix goes here."
    isDefault: Boolean!
  }

  type Query {
    "Every page, home first."
    pages: [Page!]!
    "One page. NOT_FOUND when no page has the slug."
    page(slug: ID!): Page!
    "The limits every write is checked against."
    pageLimits: PageLimits!
    "The status of every checked item on a page, from cache when fresh."
    itemStatuses(pageSlug: ID!): [ItemStatus!]!
    "Whether a site can be framed: asked before saving an app or frame item."
    frameCheck(url: String!): FrameCheck!
    "Icons whose name matches the query, glyphs first."
    iconSearch(query: String!, limit: Int): [IconOption!]!
    "The web searches the launcher offers."
    searchEngines: [SearchEngine!]!
  }

  "A new page."
  input CreatePageInput {
    title: String!
    "Lower-case letters, digits and single hyphens. Made from the title when left out."
    slug: String
    icon: String
  }

  "What to change on a page. A field left out is kept; icon: null clears the icon."
  input UpdatePageInput {
    title: String
    icon: String
  }

  "A section's fields, for adding one or replacing one's."
  input SectionInput {
    "Blank or left out for no heading."
    title: String
    "Whether it starts folded. Defaults to false."
    collapsed: Boolean
  }

  "An item's fields, for adding one or replacing one's."
  input ItemInput {
    kind: ItemKind!
    title: String!
    "An absolute http or https URL."
    url: String!
    "LINK only; NEW_TAB when left out. Ignored for FRAME."
    opensIn: OpensIn
    icon: String
    description: String
    "FRAME only, in CSS pixels; PageLimits.defaultFrameHeightPx when left out. Ignored for LINK."
    frameHeightPx: Int
    "Defaults to true."
    checkEnabled: Boolean
    "Blank or left out to check url."
    checkUrl: String
  }

  "A web search for the launcher."
  input SearchEngineInput {
    "Lower-case letters and digits: what follows ! in the launcher."
    prefix: String!
    name: String!
    "The search address, with {query} where the query goes."
    url: String!
  }

  "The launcher's web searches. A field left out uses the built-in default."
  input SearchSettingsInput {
    "At least one, with different prefixes."
    engines: [SearchEngineInput!]
    "The prefix of the engine a query with no prefix goes to."
    defaultPrefix: String
  }

  type Mutation {
    "Replaces the launcher's web searches and returns them. Null goes back to the built-in ones."
    setSearchEngines(input: SearchSettingsInput): [SearchEngine!]!
    "Adds a page at the end of the list."
    createPage(input: CreatePageInput!): Page!
    "Changes a page's title or icon."
    updatePage(slug: ID!, input: UpdatePageInput!): Page!
    "Deletes a page and everything on it, and returns its slug. The home page cannot be deleted."
    deletePage(slug: ID!): ID!
    "Moves a page within the list and returns every page. Home stays first."
    movePage(slug: ID!, toIndex: Int!): [Page!]!
    "Adds a section at the end of a page and returns the page."
    addSection(pageSlug: ID!, input: SectionInput!): Page!
    "Changes a section's heading or folding and returns the page."
    updateSection(pageSlug: ID!, id: ID!, input: SectionInput!): Page!
    "Removes a section and its items and returns the page. A page's last section can't be removed."
    removeSection(pageSlug: ID!, id: ID!): Page!
    "Moves a section within its page and returns the page."
    moveSection(pageSlug: ID!, id: ID!, toIndex: Int!): Page!
    "Adds an item at the end of a section (the first when left out) and returns the page."
    addItem(pageSlug: ID!, sectionId: ID, input: ItemInput!): Page!
    "Replaces an item's fields and returns the page."
    updateItem(pageSlug: ID!, id: ID!, input: ItemInput!): Page!
    "Removes an item and returns the page."
    removeItem(pageSlug: ID!, id: ID!): Page!
    "Moves an item within its page, into another section when toSectionId is given, and returns the page."
    moveItem(pageSlug: ID!, id: ID!, toSectionId: ID, toIndex: Int!): Page!
  }
`;
