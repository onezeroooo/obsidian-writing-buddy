const bindable = (parameters) => parameters.map(value => typeof value === "bigint" ? Number(value) : value);
export function sqlJsDriver(database) {
    const functions = new Map();
    return {
        prepare(sql) {
            return {
                get(...parameters) {
                    const statement = database.prepare(sql);
                    try {
                        statement.bind(bindable(parameters));
                        return statement.step() ? statement.getAsObject() : undefined;
                    }
                    finally {
                        statement.free();
                    }
                },
                all(...parameters) {
                    const statement = database.prepare(sql);
                    const rows = [];
                    try {
                        statement.bind(bindable(parameters));
                        while (statement.step())
                            rows.push(statement.getAsObject());
                        return rows;
                    }
                    finally {
                        statement.free();
                    }
                },
                run(...parameters) { database.run(sql, bindable(parameters)); },
                // Materialized so callers may write to the same table while consuming rows.
                iterate(...parameters) { return this.all(...parameters); },
            };
        },
        exec(sql) { database.exec(sql); },
        function(name, _options, implementation) { functions.set(name, implementation); database.create_function(name, implementation); },
        export() {
            const bytes = database.export();
            for (const [name, implementation] of functions)
                database.create_function(name, implementation);
            return bytes;
        },
        close() { database.close(); },
    };
}
