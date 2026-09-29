-- Synthetic example for scripts/propose-alters.mjs. These definitions were written by hand for this skill; they come
-- from no real site. They imitate the output of `wp db export - --no-data=true --tables=...` on MySQL 8.4:
-- wp_posts as WordPress creates it, a plugin log table created with utf8mb3, and a plugin lookup table created with
-- `DEFAULT CHARSET=utf8mb4` and no COLLATE clause, so it took the server default utf8mb4_0900_ai_ci.

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wp_posts` (
  `ID` bigint unsigned NOT NULL AUTO_INCREMENT,
  `post_author` bigint unsigned NOT NULL DEFAULT '0',
  `post_date` datetime NOT NULL DEFAULT '0000-00-00 00:00:00',
  `post_content` longtext COLLATE utf8mb4_unicode_520_ci NOT NULL,
  `post_title` text COLLATE utf8mb4_unicode_520_ci NOT NULL,
  `post_status` varchar(20) COLLATE utf8mb4_unicode_520_ci NOT NULL DEFAULT 'publish',
  `post_name` varchar(200) COLLATE utf8mb4_unicode_520_ci NOT NULL DEFAULT '',
  `post_type` varchar(20) COLLATE utf8mb4_unicode_520_ci NOT NULL DEFAULT 'post',
  PRIMARY KEY (`ID`),
  KEY `post_name` (`post_name`(191)),
  KEY `type_status_date` (`post_type`,`post_status`,`post_date`,`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

CREATE TABLE `wp_example_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `object_type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `object_name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `message` text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `object_name` (`object_name`),
  KEY `type_name` (`object_type`,`object_name`(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 ROW_FORMAT=COMPACT;

CREATE TABLE `wp_example_lookup` (
  `lookup_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `post_name` varchar(200) NOT NULL DEFAULT '',
  `label` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`lookup_id`),
  UNIQUE KEY `post_name` (`post_name`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
