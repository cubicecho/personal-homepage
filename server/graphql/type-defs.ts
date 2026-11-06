/** The served schema's SDL. Every field carries a description: it is the API's documentation. */
export const TYPE_DEFS = /* GraphQL */ `
  "What an item on a page is."
  enum ItemKind {
    "A tile that opens the URL; opensIn says where."
    LINK
    "The URL framed inline on the page, at frameHeightPx."
    FRAME
    "Data the server fetches and the page shows: values from an API, a feed, the weather."
    WIDGET
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

  "What a widget shows."
  enum WidgetType {
    "Values picked out of a JSON API's answer."
    API
    "The latest entries of an RSS or Atom feed."
    RSS
    "The weather now and for the coming hours, from Open-Meteo."
    WEATHER
  }

  "How an API widget's value is written out."
  enum ValueFormat {
    "As a number, with thousands grouped."
    NUMBER
    "As it comes."
    TEXT
    "A count of bytes, as KiB, MiB and so on."
    BYTES
    "A number that is already a percentage: 42 is 42%."
    PERCENT
    "A number of seconds, as hours, minutes and seconds."
    DURATION
    "An ISO 8601 date, or seconds or milliseconds since 1970."
    DATE
  }

  "The request methods an API widget can use."
  enum HttpMethod {
    GET
    POST
  }

  "The units a weather widget reports in."
  enum WeatherUnits {
    "°C and km/h."
    METRIC
    "°F and mph."
    IMPERIAL
  }

  "A header an API widget sends. The value is as written: a secret reference stays a reference."
  type WidgetHeader {
    name: String!
    value: String!
  }

  "One value an API widget shows."
  type ApiField {
    label: String!
    "A JSONPath into the answer: $.totalRecords, $.records[0].title, $.records.length."
    path: String!
    format: ValueFormat!
    "Mark the value when it is above this."
    warnAbove: Float
    "Mark the value when it is below this."
    warnBelow: Float
  }

  """
  What an API widget asks and shows. url, header values and body may hold secret references,
  \${env:HOMEPAGE_NAME} or \${file:/run/secrets/name}, filled in by the server only when it fetches.
  """
  type ApiWidgetSettings {
    url: String!
    method: HttpMethod!
    headers: [WidgetHeader!]!
    body: String
    fields: [ApiField!]!
  }

  "Which feed an RSS widget reads."
  type RssWidgetSettings {
    url: String!
    "How many entries it shows."
    limit: Int!
    "Whether each entry shows a line of its summary."
    showSummary: Boolean!
  }

  "Where a weather widget reports for."
  type WeatherWidgetSettings {
    latitude: Float!
    longitude: Float!
    units: WeatherUnits!
  }

  "A WIDGET item's widget. Only the settings for its type are set."
  type Widget {
    type: WidgetType!
    "How long the server reuses an answer, in seconds."
    cacheSeconds: Int!
    "How often an open page asks again, in seconds. Null asks only when the page loads."
    refreshSeconds: Int
    api: ApiWidgetSettings
    rss: RssWidgetSettings
    weather: WeatherWidgetSettings
  }

  """
  One thing on a page: a link tile, an inline frame, or a widget.

  icon is a reference: a built-in glyph name (film), di:<name> (dashboard-icons), sh:<name> (selfh.st icons),
  favicon (the site's own, fetched by the server), or an image URL. iconUrl is where the browser loads it from,
  null for a built-in glyph or no icon.
  """
  type Item {
    "Unique within its page, across its sections."
    id: ID!
    kind: ItemKind!
    title: String!
    "An absolute http or https URL. Optional for a WIDGET, where it is what the title links to; null only there."
    url: String
    "Where a LINK opens. Null for the other kinds."
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
    "What a WIDGET shows. Null for the other kinds."
    widget: Widget
    "The groups that may see it, besides editors. Empty means everyone who may see the homepage."
    visibleTo: [String!]!
  }

  "A group of items on a page, with an optional heading."
  type Section {
    "Unique within its page."
    id: ID!
    "The heading. Null draws the items with no heading."
    title: String
    "Whether it starts folded. A browser remembers its own choice after that."
    collapsed: Boolean!
    "The groups that may see it, besides editors. Empty means everyone who may see the homepage."
    visibleTo: [String!]!
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
    "The groups that may see it, besides editors. Empty means everyone who may see the homepage."
    visibleTo: [String!]!
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
    maxWidgetFields: Int!
    maxWidgetHeaders: Int!
    maxRssEntries: Int!
    minWidgetCacheSeconds: Int!
    maxWidgetCacheSeconds: Int!
    minWidgetRefreshSeconds: Int!
    maxWidgetBodyLength: Int!
  }

  "One value an API widget shows, written out."
  type ApiRow {
    label: String!
    value: String!
    "Whether it is past one of its field's warning thresholds."
    warn: Boolean!
  }

  "What an API widget shows."
  type ApiWidgetResult {
    rows: [ApiRow!]!
  }

  "One entry of a feed."
  type RssEntry {
    title: String!
    "The entry's link. Only http(s) links are kept."
    url: String
    "The feed's title."
    source: String
    "When it was published, as an ISO 8601 time."
    publishedAt: String
    "A line of its summary, as plain text, when the widget shows summaries."
    summary: String
  }

  "What an RSS widget shows."
  type RssWidgetResult {
    feedTitle: String
    entries: [RssEntry!]!
  }

  "The weather now."
  type WeatherNow {
    temperature: Float!
    apparentTemperature: Float
    "The WMO weather code."
    weatherCode: Int!
    "The code in words."
    description: String!
    windSpeed: Float
    isDay: Boolean!
  }

  "The weather in one coming hour."
  type WeatherHour {
    "The hour, in the place's own time, as YYYY-MM-DDTHH:MM."
    time: String!
    temperature: Float!
    weatherCode: Int!
    description: String!
    "The chance of rain or snow, in percent."
    precipitationChance: Float
    "Whether the sun is up in that hour."
    isDay: Boolean!
  }

  "What a weather widget shows."
  type WeatherWidgetResult {
    "As Open-Meteo writes it: °C, °F."
    temperatureUnit: String!
    "As Open-Meteo writes it: km/h, mp/h."
    windSpeedUnit: String!
    now: WeatherNow!
    "Today's highest temperature."
    high: Float
    "Today's lowest temperature."
    low: Float
    hours: [WeatherHour!]!
  }

  "Whatever a widget shows."
  union WidgetResult = ApiWidgetResult | RssWidgetResult | WeatherWidgetResult

  "A widget's latest answer. When the latest fetch failed, the last good result is served as stale, with the error."
  type WidgetData {
    "When the result was fetched, as an ISO 8601 time. Null when no fetch has worked yet."
    fetchedAt: String
    "Whether the result is an older one, served because the latest fetch failed."
    stale: Boolean!
    "Why the latest fetch failed, in a sentence. It never holds a secret's value."
    error: String
    result: WidgetResult
  }

  "A widget's test run from the editor. Nothing is kept."
  type WidgetPreview {
    result: WidgetResult
    error: String
    "For an API widget, the answer as indented JSON, cut short at a limit, to write paths against."
    raw: String
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
    "A widget item's latest data, from cache when fresh. NOT_FOUND when the page or item doesn't exist."
    widgetData(pageSlug: ID!, itemId: ID!): WidgetData!
    "Runs a widget that hasn't been saved, for the editor's test."
    widgetPreview(input: WidgetInput!): WidgetPreview!
  }

  "A header for an API widget to send."
  input WidgetHeaderInput {
    name: String!
    "May hold a secret reference."
    value: String!
  }

  "One value for an API widget to show."
  input ApiFieldInput {
    label: String!
    path: String!
    "TEXT when left out."
    format: ValueFormat
    warnAbove: Float
    warnBelow: Float
  }

  "What an API widget asks and shows."
  input ApiWidgetSettingsInput {
    url: String!
    "GET when left out."
    method: HttpMethod
    headers: [WidgetHeaderInput!]
    "Sent with a POST."
    body: String
    fields: [ApiFieldInput!]!
  }

  "Which feed an RSS widget reads."
  input RssWidgetSettingsInput {
    url: String!
    limit: Int
    showSummary: Boolean
  }

  "Where a weather widget reports for."
  input WeatherWidgetSettingsInput {
    latitude: Float!
    longitude: Float!
    "METRIC when left out."
    units: WeatherUnits
  }

  "A widget: its type, its timing, and the settings for that type (the others are ignored)."
  input WidgetInput {
    type: WidgetType!
    "The type's default when left out."
    cacheSeconds: Int
    refreshSeconds: Int
    api: ApiWidgetSettingsInput
    rss: RssWidgetSettingsInput
    weather: WeatherWidgetSettingsInput
  }

  "A new page."
  input CreatePageInput {
    title: String!
    "Lower-case letters, digits and single hyphens. Made from the title when left out."
    slug: String
    icon: String
    "The groups that may see it, besides editors. Empty or left out for everyone."
    visibleTo: [String!]
  }

  "What to change on a page. A field left out is kept; icon: null clears the icon."
  input UpdatePageInput {
    title: String
    icon: String
    "The groups that may see it, besides editors. Empty for everyone; left out to keep."
    visibleTo: [String!]
  }

  "A section's fields, for adding one or replacing one's."
  input SectionInput {
    "Blank or left out for no heading."
    title: String
    "Whether it starts folded. Defaults to false."
    collapsed: Boolean
    "The groups that may see it, besides editors. Empty or left out for everyone."
    visibleTo: [String!]
  }

  "An item's fields, for adding one or replacing one's."
  input ItemInput {
    kind: ItemKind!
    title: String!
    "An absolute http or https URL. Required for LINK and FRAME; optional for WIDGET."
    url: String
    "LINK only; NEW_TAB when left out. Ignored for the others."
    opensIn: OpensIn
    icon: String
    description: String
    "FRAME only, in CSS pixels; PageLimits.defaultFrameHeightPx when left out. Ignored for LINK."
    frameHeightPx: Int
    "Defaults to true, except for a WIDGET."
    checkEnabled: Boolean
    "Blank or left out to check url."
    checkUrl: String
    "WIDGET only, and required there."
    widget: WidgetInput
    "The groups that may see it, besides editors. Empty or left out for everyone."
    visibleTo: [String!]
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
    """
    Moves an item to another page, everything about it included, and returns both pages and its id there.
    It goes to toSectionId, or that page's first section, at toIndex, or the end. Moving to its own page
    works as moveItem does.
    """
    moveItemToPage(pageSlug: ID!, id: ID!, toPageSlug: ID!, toSectionId: ID, toIndex: Int): MoveItemResult!
  }

  "Where an item went when it moved to another page."
  type MoveItemResult {
    "The page it left."
    from: Page!
    "The page it went to. The same page when it was moved within its own."
    to: Page!
    "Its id on the page it went to: the same, unless that page already had an item with that id."
    itemId: ID!
  }
`;
