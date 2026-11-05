package by.autopost;

import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class Database {
  final JdbcTemplate jdbc;

  Database(JdbcTemplate jdbc, @Value("${autopost.data-dir}") String directory) throws Exception {
    this.jdbc = jdbc;
    Files.createDirectories(Path.of(directory));
    jdbc.execute("PRAGMA journal_mode=WAL");
    jdbc.execute("PRAGMA busy_timeout=5000");
    for (String sql :
        List.of(
            "CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,login TEXT NOT NULL"
                + " UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,profile_id TEXT NOT NULL"
                + " REFERENCES profiles(id),expires INTEGER NOT NULL,workspace_id TEXT NOT NULL"
                + " DEFAULT '')",
            "CREATE TABLE IF NOT EXISTS settings(profile_id TEXT PRIMARY KEY REFERENCES"
                + " profiles(id),data TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS members(owner_id TEXT NOT NULL REFERENCES"
                + " profiles(id),member_id TEXT NOT NULL REFERENCES profiles(id),PRIMARY"
                + " KEY(owner_id,member_id))")) jdbc.execute(sql);
    if (rows("PRAGMA table_info(sessions)").stream()
        .noneMatch(r -> "workspace_id".equals(r.get("name"))))
      jdbc.execute("ALTER TABLE sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''");
  }

  List<Map<String, Object>> rows(String sql, Object... args) {
    return jdbc.queryForList(sql, args);
  }

  Map<String, Object> one(String sql, Object... args) {
    var rows = rows(sql, args);
    return rows.isEmpty() ? null : rows.get(0);
  }

  long count(String sql, Object... args) {
    return jdbc.queryForObject(sql, Long.class, args);
  }

  void run(String sql, Object... args) {
    jdbc.update(sql, args);
  }
}
