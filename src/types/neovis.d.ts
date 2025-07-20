declare module 'neovis.js' {
  interface NeoVisConfig {
    containerId: string;
    neo4j: {
      serverUrl: string;
      serverUser: string;
      serverPassword?: string;
      database?: string;
    };
    labels?: {
      [key: string]: {
        caption?: string;
        size?: string;
        community?: string;
        title?: string;
        [key: string]: any;
      };
    };
    relationships?: {
      [key: string]: {
        caption?: boolean;
        [key: string]: any;
      };
    };
    initialCypher?: string;
    vis?: any; // Vis.js options
  }

  class NeoVis {
    constructor(config: NeoVisConfig);
    render(): void;
    clear(): void;
    // Add other methods if needed
  }

  export default NeoVis;
}