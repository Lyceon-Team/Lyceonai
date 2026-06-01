SQL outputs from supabase current structure 

| table\_schema | table\_name                   | ordinal\_position | column\_name                            | data\_type                | udt\_name    | is\_nullable | column\_default                               | character\_maximum\_length | numeric\_precision | numeric\_scale | datetime\_precision |  
| \------------ | \---------------------------- | \---------------- | \-------------------------------------- | \------------------------ | \----------- | \----------- | \-------------------------------------------- | \------------------------ | \----------------- | \------------- | \------------------ |  
| public       | answer\_attempts              | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 2                | session\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 3                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 4                | question\_id                            | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 6                | is\_correct                             | boolean                  | bool        | NO          | false                                        | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 7                | outcome                                | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 10               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | answer\_attempts              | 11               | selected\_answer                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 12               | free\_response\_answer                   | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 13               | time\_spent\_ms                          | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | answer\_attempts              | 14               | session\_item\_id                        | uuid                     | uuid        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | answer\_attempts              | 15               | client\_attempt\_id                      | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | competency\_events            | 2                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 3                | question\_id                            | uuid                     | uuid        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 4                | session\_id                             | uuid                     | uuid        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 5                | competency                             | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 6                | event\_source                           | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 7                | event\_type                             | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 8                | delta                                  | numeric                  | numeric     | NO          | null                                         | null                     | null              | null          | null               |  
| public       | competency\_events            | 9                | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | competency\_events            | 10               | occurred\_at                            | timestamp with time zone | timestamptz | YES         | now()                                        | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_questions   | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 2                | module\_id                              | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 3                | question\_id                            | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 4                | order\_index                            | integer                  | int4        | NO          | null                                         | null                     | 32                | 0             | null               |  
| public       | full\_length\_exam\_questions   | 5                | presented\_at                           | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_questions   | 6                | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_questions   | 7                | question\_canonical\_id                  | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 8                | question\_stem                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 9                | question\_section                       | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 10               | question\_section\_code                  | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 11               | question\_type                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 12               | question\_options                       | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 13               | question\_difficulty                    | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | full\_length\_exam\_questions   | 14               | question\_domain                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 15               | question\_skill                         | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 16               | question\_subskill                      | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 17               | question\_source\_type                   | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | full\_length\_exam\_questions   | 18               | question\_diagram\_present               | boolean                  | bool        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 19               | question\_tags                          | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 20               | question\_competencies                  | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 21               | question\_answer\_text                   | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 22               | question\_explanation                   | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 23               | question\_exam                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 24               | question\_structure\_cluster\_id          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_questions   | 25               | question\_correct\_answer                | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 2                | session\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 3                | module\_id                              | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 4                | question\_id                            | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 5                | selected\_answer                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 6                | free\_response\_answer                   | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 7                | is\_correct                             | boolean                  | bool        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_responses   | 8                | answered\_at                            | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_responses   | 9                | submitted\_at                           | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_responses   | 10               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_responses   | 11               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_sessions    | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_sessions    | 2                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_sessions    | 3                | status                                 | text                     | text        | NO          | 'not\_started'::text                          | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_sessions    | 4                | current\_section                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_sessions    | 5                | current\_module                         | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | full\_length\_exam\_sessions    | 6                | seed                                   | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_sessions    | 7                | started\_at                             | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_sessions    | 8                | completed\_at                           | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_sessions    | 9                | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_sessions    | 10               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | full\_length\_exam\_sessions    | 11               | test\_form\_id                           | text                     | text        | NO          | '00000000-0000-4000-8000-000000000001'::text | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_sessions    | 12               | client\_instance\_id                     | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | full\_length\_exam\_sessions    | 13               | break\_started\_at                       | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | practice\_session\_items       | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 2                | session\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 3                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 4                | question\_canonical\_id                  | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 5                | ordinal                                | integer                  | int4        | NO          | null                                         | null                     | 32                | 0             | null               |  
| public       | practice\_session\_items       | 6                | status                                 | text                     | text        | NO          | 'served'::text                               | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 7                | attempt\_id                             | uuid                     | uuid        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 8                | client\_instance\_id                     | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 9                | option\_order                           | ARRAY                    | \_text       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 10               | answered\_at                            | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | practice\_session\_items       | 11               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | practice\_session\_items       | 12               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | practice\_session\_items       | 13               | option\_token\_map                       | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 14               | question\_id                            | uuid                     | uuid        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 15               | question\_section                       | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 16               | question\_stem                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 17               | question\_options                       | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 18               | question\_difficulty                    | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | practice\_session\_items       | 19               | question\_explanation                   | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 20               | question\_domain                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 21               | question\_skill                         | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 22               | question\_subskill                      | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 23               | question\_exam                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 24               | question\_structure\_cluster\_id          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 25               | question\_correct\_answer                | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 26               | selected\_answer                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 27               | is\_correct                             | boolean                  | bool        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 28               | outcome                                | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_session\_items       | 29               | time\_spent\_ms                          | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | practice\_session\_items       | 30               | client\_attempt\_id                      | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 2                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 3                | mode                                   | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 4                | section                                | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 5                | difficulty                             | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 6                | target\_duration\_ms                     | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | practice\_sessions            | 7                | actual\_duration\_ms                     | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | practice\_sessions            | 8                | started\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | practice\_sessions            | 9                | finished\_at                            | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | practice\_sessions            | 10               | status                                 | text                     | text        | NO          | 'in\_progress'::text                          | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 11               | question\_ids                           | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 12               | completed                              | boolean                  | bool        | NO          | false                                        | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 13               | metadata                               | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | practice\_sessions            | 14               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | practice\_sessions            | 15               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | questions                    | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | questions                    | 7                | stem                                   | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 8                | question\_type                          | text                     | text        | NO          | 'multiple\_choice'::text                      | null                     | null              | null          | null               |  
| public       | questions                    | 10               | options                                | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 13               | answer\_text                            | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 14               | explanation                            | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 15               | difficulty                             | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | questions                    | 18               | tags                                   | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 23               | embedding                              | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 25               | provenance\_chunk\_ids                   | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 31               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | questions                    | 32               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | questions                    | 34               | canonical\_id                           | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 35               | test\_code                              | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 36               | section\_code                           | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 37               | source\_type                            | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | questions                    | 40               | domain                                 | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 41               | skill                                  | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 42               | subskill                               | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 46               | diagram\_present                        | boolean                  | bool        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | questions                    | 48               | correct\_answer                         | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 2                | student\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 3                | question\_id                            | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 4                | context                                | text                     | text        | NO          | 'review\_errors'::text                        | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 5                | selected\_answer                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 6                | is\_correct                             | boolean                  | bool        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 7                | seconds\_spent                          | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | review\_error\_attempts        | 8                | client\_attempt\_id                      | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_error\_attempts        | 9                | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | review\_session\_items         | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 2                | review\_session\_id                      | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 3                | student\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 4                | ordinal                                | integer                  | int4        | NO          | null                                         | null                     | 32                | 0             | null               |  
| public       | review\_session\_items         | 5                | question\_canonical\_id                  | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 6                | source\_question\_id                     | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 7                | source\_question\_canonical\_id           | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 8                | source\_origin                          | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 9                | retry\_mode                             | text                     | text        | NO          | 'same\_question'::text                        | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 10               | status                                 | text                     | text        | NO          | 'queued'::text                               | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 11               | attempt\_id                             | uuid                     | uuid        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 12               | tutor\_opened\_at                        | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | review\_session\_items         | 13               | answered\_at                            | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | review\_session\_items         | 14               | source\_attempted\_at                    | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | review\_session\_items         | 15               | client\_instance\_id                     | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 16               | option\_order                           | ARRAY                    | \_text       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 17               | option\_token\_map                       | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 18               | question\_section                       | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 19               | question\_stem                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 20               | question\_options                       | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 21               | question\_difficulty                    | jsonb                    | jsonb       | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 22               | question\_domain                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 23               | question\_skill                         | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 24               | question\_subskill                      | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 25               | question\_exam                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 26               | question\_structure\_cluster\_id          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 27               | question\_correct\_answer                | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 28               | question\_explanation                   | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_session\_items         | 29               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | review\_session\_items         | 30               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | review\_session\_items         | 31               | question\_difficulty\_bucket             | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | review\_sessions              | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | review\_sessions              | 2                | student\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | review\_sessions              | 3                | status                                 | text                     | text        | NO          | 'created'::text                              | null                     | null              | null          | null               |  
| public       | review\_sessions              | 4                | source\_context                         | text                     | text        | NO          | 'review\_errors'::text                        | null                     | null              | null          | null               |  
| public       | review\_sessions              | 5                | started\_at                             | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | review\_sessions              | 6                | completed\_at                           | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | review\_sessions              | 7                | abandoned\_at                           | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | review\_sessions              | 8                | client\_instance\_id                     | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_sessions              | 9                | idempotency\_key                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | review\_sessions              | 10               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | review\_sessions              | 11               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_domain\_mastery       | 1                | student\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_domain\_mastery       | 2                | section                                | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_domain\_mastery       | 3                | domain                                 | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_domain\_mastery       | 4                | skills\_total                           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_domain\_mastery       | 5                | questions\_total                        | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_domain\_mastery       | 6                | questions\_correct                      | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_domain\_mastery       | 7                | questions\_incorrect                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_domain\_mastery       | 8                | mastery\_score                          | numeric                  | numeric     | NO          | 0                                            | null                     | null              | null          | null               |  
| public       | student\_domain\_mastery       | 9                | mastery\_pct                            | numeric                  | numeric     | NO          | 0                                            | null                     | null              | null          | null               |  
| public       | student\_domain\_mastery       | 10               | mastery\_level                          | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_domain\_mastery       | 11               | last\_attempt\_at                        | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | student\_domain\_mastery       | 12               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_domain\_mastery       | 13               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_counters\_current | 1                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_counters\_current | 2                | total\_answered\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 3                | total\_correct\_count                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 4                | total\_wrong\_count                      | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 5                | practice\_answered\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 6                | practice\_correct\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 7                | practice\_wrong\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 8                | review\_answered\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 9                | review\_correct\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 10               | review\_wrong\_count                     | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 11               | full\_length\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 12               | full\_length\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 13               | full\_length\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 14               | flowcard\_answered\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 15               | flowcard\_correct\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 16               | flowcard\_wrong\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 17               | math\_answered\_count                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 18               | math\_correct\_count                     | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 19               | math\_wrong\_count                       | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 20               | rw\_answered\_count                      | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 21               | rw\_correct\_count                       | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 22               | rw\_wrong\_count                         | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 23               | overall\_score\_projection               | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_counters\_current | 24               | math\_score\_projection                  | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_counters\_current | 25               | rw\_score\_projection                    | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_counters\_current | 26               | readiness\_metric                       | numeric                  | numeric     | YES         | null                                         | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_counters\_current | 27               | confidence\_metric                      | numeric                  | numeric     | YES         | null                                         | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_counters\_current | 28               | consistency\_metric                     | numeric                  | numeric     | YES         | null                                         | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_counters\_current | 29               | last\_recalculated\_at                   | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_counters\_current | 30               | last\_event\_type                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_counters\_current | 31               | last\_event\_id                          | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_counters\_current | 32               | source\_version                         | text                     | text        | NO          | 'kpi\_truth\_v1'::text                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_counters\_current | 33               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_counters\_current | 34               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_counters\_current | 35               | m\_alg\_answered\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 36               | m\_alg\_correct\_count                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 37               | m\_alg\_wrong\_count                      | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 38               | m\_advm\_answered\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 39               | m\_advm\_correct\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 40               | m\_advm\_wrong\_count                     | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 41               | m\_prob\_answered\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 42               | m\_prob\_correct\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 43               | m\_prob\_wrong\_count                     | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 44               | m\_geo\_answered\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 45               | m\_geo\_correct\_count                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 46               | m\_geo\_wrong\_count                      | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 47               | rw\_craft\_answered\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 48               | rw\_craft\_correct\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 49               | rw\_craft\_wrong\_count                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 50               | rw\_info\_answered\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 51               | rw\_info\_correct\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 52               | rw\_info\_wrong\_count                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 53               | rw\_stdeng\_answered\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 54               | rw\_stdeng\_correct\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 55               | rw\_stdeng\_wrong\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 56               | rw\_expr\_answered\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 57               | rw\_expr\_correct\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 58               | rw\_expr\_wrong\_count                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 59               | m\_alg\_leq\_answered\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 60               | m\_alg\_leq\_correct\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 61               | m\_alg\_leq\_wrong\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 62               | m\_alg\_linq\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 63               | m\_alg\_linq\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 64               | m\_alg\_linq\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 65               | m\_alg\_lfn\_answered\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 66               | m\_alg\_lfn\_correct\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 67               | m\_alg\_lfn\_wrong\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 68               | m\_alg\_syseq\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 69               | m\_alg\_syseq\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 70               | m\_alg\_syseq\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 71               | m\_alg\_absv\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 72               | m\_alg\_absv\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 73               | m\_alg\_absv\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 74               | m\_advm\_quad\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 75               | m\_advm\_quad\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 76               | m\_advm\_quad\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 77               | m\_advm\_poly\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 78               | m\_advm\_poly\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 79               | m\_advm\_poly\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 80               | m\_advm\_expfn\_answered\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 81               | m\_advm\_expfn\_correct\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 82               | m\_advm\_expfn\_wrong\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 83               | m\_advm\_radexp\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 84               | m\_advm\_radexp\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 85               | m\_advm\_radexp\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 86               | m\_advm\_ratexp\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 87               | m\_advm\_ratexp\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 88               | m\_advm\_ratexp\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 89               | m\_prob\_rrp\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 90               | m\_prob\_rrp\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 91               | m\_prob\_rrp\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 92               | m\_prob\_pct\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 93               | m\_prob\_pct\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 94               | m\_prob\_pct\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 95               | m\_prob\_unitc\_answered\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 96               | m\_prob\_unitc\_correct\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 97               | m\_prob\_unitc\_wrong\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 98               | m\_prob\_lg\_answered\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 99               | m\_prob\_lg\_correct\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 100              | m\_prob\_lg\_wrong\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 101              | m\_prob\_dint\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 102              | m\_prob\_dint\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 103              | m\_prob\_dint\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 104              | m\_prob\_prob\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 105              | m\_prob\_prob\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 106              | m\_prob\_prob\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 107              | m\_prob\_stat\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 108              | m\_prob\_stat\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 109              | m\_prob\_stat\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 110              | m\_geo\_arvol\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 111              | m\_geo\_arvol\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 112              | m\_geo\_arvol\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 113              | m\_geo\_lang\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 114              | m\_geo\_lang\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 115              | m\_geo\_lang\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 116              | m\_geo\_tri\_answered\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 117              | m\_geo\_tri\_correct\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 118              | m\_geo\_tri\_wrong\_count                  | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 119              | m\_geo\_circ\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 120              | m\_geo\_circ\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 121              | m\_geo\_circ\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 122              | m\_geo\_trig\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 123              | m\_geo\_trig\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 124              | m\_geo\_trig\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 125              | m\_geo\_cgeo\_answered\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 126              | m\_geo\_cgeo\_correct\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 127              | m\_geo\_cgeo\_wrong\_count                 | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 128              | rw\_craft\_wic\_answered\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 129              | rw\_craft\_wic\_correct\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 130              | rw\_craft\_wic\_wrong\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 131              | rw\_craft\_txts\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 132              | rw\_craft\_txts\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 133              | rw\_craft\_txts\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 134              | rw\_craft\_ctxt\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 135              | rw\_craft\_ctxt\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 136              | rw\_craft\_ctxt\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 137              | rw\_craft\_purp\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 138              | rw\_craft\_purp\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 139              | rw\_craft\_purp\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 140              | rw\_info\_cidea\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 141              | rw\_info\_cidea\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 142              | rw\_info\_cidea\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 143              | rw\_info\_coet\_answered\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 144              | rw\_info\_coet\_correct\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 145              | rw\_info\_coet\_wrong\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 146              | rw\_info\_coeq\_answered\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 147              | rw\_info\_coeq\_correct\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 148              | rw\_info\_coeq\_wrong\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 149              | rw\_info\_inf\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 150              | rw\_info\_inf\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 151              | rw\_info\_inf\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 152              | rw\_stdeng\_bnd\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 153              | rw\_stdeng\_bnd\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 154              | rw\_stdeng\_bnd\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 155              | rw\_stdeng\_fss\_answered\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 156              | rw\_stdeng\_fss\_correct\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 157              | rw\_stdeng\_fss\_wrong\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 158              | rw\_stdeng\_punc\_answered\_count          | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 159              | rw\_stdeng\_punc\_correct\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 160              | rw\_stdeng\_punc\_wrong\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 161              | rw\_stdeng\_vten\_answered\_count          | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 162              | rw\_stdeng\_vten\_correct\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 163              | rw\_stdeng\_vten\_wrong\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 164              | rw\_stdeng\_prag\_answered\_count          | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 165              | rw\_stdeng\_prag\_correct\_count           | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 166              | rw\_stdeng\_prag\_wrong\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 167              | rw\_expr\_rsy\_answered\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 168              | rw\_expr\_rsy\_correct\_count              | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 169              | rw\_expr\_rsy\_wrong\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 170              | rw\_expr\_tran\_answered\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 171              | rw\_expr\_tran\_correct\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 172              | rw\_expr\_tran\_wrong\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 173              | rw\_expr\_spla\_answered\_count            | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 174              | rw\_expr\_spla\_correct\_count             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_counters\_current | 175              | rw\_expr\_spla\_wrong\_count               | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_rollups\_current  | 1                | student\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_rollups\_current  | 2                | section                                | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_rollups\_current  | 3                | domain                                 | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_rollups\_current  | 4                | skill                                  | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_rollups\_current  | 5                | difficulty                             | integer                  | int4        | NO          | null                                         | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_rollups\_current  | 6                | source\_family                          | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_rollups\_current  | 7                | total\_questions                        | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_rollups\_current  | 8                | correct\_questions                      | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_rollups\_current  | 9                | incorrect\_questions                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_rollups\_current  | 10               | accuracy\_pct                           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_rollups\_current  | 11               | avg\_latency\_ms                         | numeric                  | numeric     | YES         | null                                         | null                     | 10                | 2             | null               |  
| public       | student\_kpi\_rollups\_current  | 12               | last\_attempt\_at                        | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_rollups\_current  | 13               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_rollups\_current  | 14               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_snapshots        | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | student\_kpi\_snapshots        | 2                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_snapshots        | 3                | snapshot\_at                            | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_snapshots        | 4                | source\_version                         | text                     | text        | NO          | 'kpi\_truth\_v1'::text                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_snapshots        | 5                | trigger\_event\_type                     | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_snapshots        | 6                | trigger\_event\_id                       | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_kpi\_snapshots        | 7                | current\_week\_practice\_sessions         | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_snapshots        | 8                | current\_week\_practice\_minutes          | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_snapshots        | 9                | current\_week\_questions\_solved          | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_snapshots        | 10               | current\_week\_accuracy\_percent          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 11               | current\_week\_avg\_seconds\_per\_question  | numeric                  | numeric     | NO          | 0                                            | null                     | 8                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 12               | previous\_week\_practice\_sessions        | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_snapshots        | 13               | previous\_week\_practice\_minutes         | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_snapshots        | 14               | previous\_week\_questions\_solved         | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_snapshots        | 15               | previous\_week\_accuracy\_percent         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 16               | previous\_week\_avg\_seconds\_per\_question | numeric                  | numeric     | NO          | 0                                            | null                     | 8                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 17               | recency\_200\_total\_attempts             | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_kpi\_snapshots        | 18               | recency\_200\_accuracy\_percent           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 19               | recency\_200\_avg\_seconds\_per\_question   | numeric                  | numeric     | NO          | 0                                            | null                     | 8                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 20               | overall\_score\_projection               | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 21               | math\_score\_projection                  | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 22               | rw\_score\_projection                    | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 23               | readiness\_metric                       | numeric                  | numeric     | YES         | null                                         | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 24               | confidence\_metric                      | numeric                  | numeric     | YES         | null                                         | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 25               | consistency\_metric                     | numeric                  | numeric     | YES         | null                                         | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 26               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_snapshots        | 27               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_kpi\_snapshots        | 28               | m\_alg\_score\_projection                 | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 29               | m\_advm\_score\_projection                | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 30               | m\_prob\_score\_projection                | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 31               | m\_geo\_score\_projection                 | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 32               | rw\_craft\_score\_projection              | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 33               | rw\_info\_score\_projection               | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 34               | rw\_stdeng\_score\_projection             | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 35               | rw\_expr\_score\_projection               | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 36               | m\_alg\_leq\_score\_projection             | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 37               | m\_alg\_linq\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 38               | m\_alg\_lfn\_score\_projection             | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 39               | m\_alg\_syseq\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 40               | m\_alg\_absv\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 41               | m\_advm\_quad\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 42               | m\_advm\_poly\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 43               | m\_advm\_expfn\_score\_projection          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 44               | m\_advm\_radexp\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 45               | m\_advm\_ratexp\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 46               | m\_prob\_rrp\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 47               | m\_prob\_pct\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 48               | m\_prob\_unitc\_score\_projection          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 49               | m\_prob\_lg\_score\_projection             | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 50               | m\_prob\_dint\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 51               | m\_prob\_prob\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 52               | m\_prob\_stat\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 53               | m\_geo\_arvol\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 54               | m\_geo\_lang\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 55               | m\_geo\_tri\_score\_projection             | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 56               | m\_geo\_circ\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 57               | m\_geo\_trig\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 58               | m\_geo\_cgeo\_score\_projection            | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 59               | rw\_craft\_wic\_score\_projection          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 60               | rw\_craft\_txts\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 61               | rw\_craft\_ctxt\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 62               | rw\_craft\_purp\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 63               | rw\_info\_cidea\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 64               | rw\_info\_coet\_score\_projection          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 65               | rw\_info\_coeq\_score\_projection          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 66               | rw\_info\_inf\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 67               | rw\_stdeng\_bnd\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 68               | rw\_stdeng\_fss\_score\_projection         | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 69               | rw\_stdeng\_punc\_score\_projection        | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 70               | rw\_stdeng\_vten\_score\_projection        | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 71               | rw\_stdeng\_prag\_score\_projection        | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 72               | rw\_expr\_rsy\_score\_projection           | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 73               | rw\_expr\_tran\_score\_projection          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_kpi\_snapshots        | 74               | rw\_expr\_spla\_score\_projection          | numeric                  | numeric     | NO          | 0                                            | null                     | 6                 | 2             | null               |  
| public       | student\_question\_attempts    | 1                | id                                     | uuid                     | uuid        | NO          | gen\_random\_uuid()                            | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 2                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 3                | question\_canonical\_id                  | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 4                | is\_correct                             | boolean                  | bool        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 5                | time\_spent\_ms                          | integer                  | int4        | YES         | null                                         | null                     | 32                | 0             | null               |  
| public       | student\_question\_attempts    | 6                | selected\_choice                        | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 7                | answered\_at                            | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_question\_attempts    | 8                | exam                                   | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 9                | section                                | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 10               | domain                                 | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 11               | skill                                  | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 12               | subskill                               | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 13               | difficulty\_bucket                      | text                     | text        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 14               | structure\_cluster\_id                   | uuid                     | uuid        | YES         | null                                         | null                     | null              | null          | null               |  
| public       | student\_question\_attempts    | 15               | occurred\_at                            | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_section\_projections  | 1                | student\_id                             | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_section\_projections  | 2                | section                                | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_section\_projections  | 3                | projected\_score\_mid                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_section\_projections  | 4                | projected\_score\_low                    | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_section\_projections  | 5                | projected\_score\_high                   | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_section\_projections  | 6                | range\_width                            | integer                  | int4        | NO          | 120                                          | null                     | 32                | 0             | null               |  
| public       | student\_section\_projections  | 7                | relevant\_question\_count                | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | student\_section\_projections  | 8                | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_section\_projections  | 9                | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_skill\_mastery        | 1                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 2                | section                                | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 3                | domain                                 | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 4                | skill                                  | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 5                | attempts                               | numeric                  | numeric     | NO          | 0                                            | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 6                | correct                                | numeric                  | numeric     | NO          | 0                                            | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 7                | accuracy                               | numeric                  | numeric     | NO          | 0                                            | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 8                | last\_attempt\_at                        | timestamp with time zone | timestamptz | YES         | null                                         | null                     | null              | null          | 6                  |  
| public       | student\_skill\_mastery        | 9                | mastery\_score                          | numeric                  | numeric     | NO          | 0.0                                          | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 10               | created\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_skill\_mastery        | 11               | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |  
| public       | student\_skill\_mastery        | 12               | mastery\_pct                            | numeric                  | numeric     | NO          | 0.0                                          | null                     | null              | null          | null               |  
| public       | student\_skill\_mastery        | 13               | mastery\_level                          | integer                  | int4        | NO          | 0                                            | null                     | 32                | 0             | null               |  
| public       | user\_competencies            | 1                | user\_id                                | uuid                     | uuid        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | user\_competencies            | 2                | competency                             | text                     | text        | NO          | null                                         | null                     | null              | null          | null               |  
| public       | user\_competencies            | 3                | score                                  | numeric                  | numeric     | NO          | 0                                            | null                     | null              | null          | null               |  
| public       | user\_competencies            | 4                | updated\_at                             | timestamp with time zone | timestamptz | NO          | now()                                        | null                     | null              | null          | 6                  |

| schema\_name | function\_name                                  | identity\_arguments                                                                                                                                                                          | full\_arguments                                                                                                                                                                                                                  | return\_type                  | language | security\_definer | volatility | parallel\_safety | function\_definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |  
| \----------- | \---------------------------------------------- | \------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | \------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | \---------------------------- | \-------- | \---------------- | \---------- | \--------------- | \-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |  
| public      | apply\_learning\_event\_to\_mastery                | p\_student\_id uuid, p\_section text, p\_domain text, p\_skill text, p\_difficulty integer, p\_source\_family text, p\_correct boolean, p\_latency\_ms integer, p\_occurred\_at timestamp with time zone | p\_student\_id uuid, p\_section text, p\_domain text, p\_skill text, p\_difficulty integer, p\_source\_family text, p\_correct boolean, p\_latency\_ms integer DEFAULT NULL::integer, p\_occurred\_at timestamp with time zone DEFAULT now() | jsonb                        | plpgsql  | true             | v          | u               | CREATE OR REPLACE FUNCTION public.apply\_learning\_event\_to\_mastery(p\_student\_id uuid, p\_section text, p\_domain text, p\_skill text, p\_difficulty integer, p\_source\_family text, p\_correct boolean, p\_latency\_ms integer DEFAULT NULL::integer, p\_occurred\_at timestamp with time zone DEFAULT now())  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
declare  
  v\_difficulty integer;  
  v\_alpha numeric;  
  v\_base\_delta numeric;  
  v\_difficulty\_multiplier numeric;  
  v\_effective\_delta numeric;  
  v\_old\_score numeric;  
  v\_new\_score numeric;  
  v\_new\_pct numeric;  
  v\_new\_level integer;  
  v\_new\_attempts numeric;  
  v\_new\_correct numeric;  
  v\_new\_accuracy numeric;  
  v\_domain\_row public.student\_domain\_mastery%rowtype;  
  v\_section\_projection public.student\_section\_projections%rowtype;  
begin  
  if p\_student\_id is null then  
    raise exception 'p\_student\_id is required';  
  end if;

  if p\_section not in ('M', 'RW') then  
    raise exception 'Invalid section %. Expected M or RW.', p\_section;  
  end if;

  if p\_source\_family not in ('practice', 'review', 'test') then  
    raise exception 'Invalid source\_family %. Expected practice, review, or test.', p\_source\_family;  
  end if;

  v\_difficulty := public.normalize\_difficulty\_bucket(p\_difficulty);  
  v\_alpha := public.get\_mastery\_constant\_num('alpha');  
  v\_base\_delta := public.get\_base\_delta(p\_source\_family, p\_correct);  
  v\_difficulty\_multiplier := public.get\_difficulty\_multiplier(v\_difficulty);  
  v\_effective\_delta := v\_base\_delta \* v\_difficulty\_multiplier;

  insert into public.student\_kpi\_rollups\_current (  
    student\_id,  
    section,  
    domain,  
    skill,  
    difficulty,  
    source\_family,  
    total\_questions,  
    correct\_questions,  
    incorrect\_questions,  
    accuracy\_pct,  
    avg\_latency\_ms,  
    last\_attempt\_at,  
    created\_at,  
    updated\_at  
  )  
  values (  
    p\_student\_id,  
    p\_section,  
    p\_domain,  
    p\_skill,  
    v\_difficulty,  
    p\_source\_family,  
    1,  
    case when p\_correct then 1 else 0 end,  
    case when p\_correct then 0 else 1 end,  
    case when p\_correct then 100 else 0 end,  
    p\_latency\_ms,  
    p\_occurred\_at,  
    now(),  
    now()  
  )  
  on conflict (student\_id, domain, skill, difficulty, source\_family) do update  
  set total\_questions \= public.student\_kpi\_rollups\_current.total\_questions \+ 1,  
      correct\_questions \= public.student\_kpi\_rollups\_current.correct\_questions \+ case when p\_correct then 1 else 0 end,  
      incorrect\_questions \= public.student\_kpi\_rollups\_current.incorrect\_questions \+ case when p\_correct then 0 else 1 end,  
      accuracy\_pct \= round(  
        (  
          (public.student\_kpi\_rollups\_current.correct\_questions \+ case when p\_correct then 1 else 0 end)::numeric  
          / nullif(public.student\_kpi\_rollups\_current.total\_questions \+ 1, 0)::numeric  
        ) \* 100.0,  
        2  
      ),  
      avg\_latency\_ms \= case  
        when p\_latency\_ms is null then public.student\_kpi\_rollups\_current.avg\_latency\_ms  
        when public.student\_kpi\_rollups\_current.avg\_latency\_ms is null then p\_latency\_ms  
        else round(  
          (  
            (public.student\_kpi\_rollups\_current.avg\_latency\_ms \* public.student\_kpi\_rollups\_current.total\_questions)  
            \+ p\_latency\_ms  
          ) / (public.student\_kpi\_rollups\_current.total\_questions \+ 1),  
          2  
        )  
      end,  
      last\_attempt\_at \= greatest(coalesce(public.student\_kpi\_rollups\_current.last\_attempt\_at, p\_occurred\_at), p\_occurred\_at),  
      updated\_at \= now();

  select mastery\_score, attempts, correct  
    into v\_old\_score, v\_new\_attempts, v\_new\_correct  
  from public.student\_skill\_mastery  
  where user\_id \= p\_student\_id  
    and section \= p\_section  
    and domain \= p\_domain  
    and skill \= p\_skill;

  v\_old\_score := coalesce(v\_old\_score, 0.0);  
  v\_new\_attempts := coalesce(v\_new\_attempts, 0\) \+ 1;  
  v\_new\_correct := coalesce(v\_new\_correct, 0\) \+ case when p\_correct then 1 else 0 end;  
  v\_new\_accuracy := round((v\_new\_correct / nullif(v\_new\_attempts, 0)) \* 100.0, 2);  
  v\_new\_score := greatest(  
    public.get\_mastery\_constant\_num('mastery\_min'),  
    least(  
      public.get\_mastery\_constant\_num('mastery\_max'),  
      v\_old\_score \+ (v\_alpha \* v\_effective\_delta)  
    )  
  );  
  v\_new\_pct := round(v\_new\_score \* 100.0, 2);  
  v\_new\_level := public.map\_mastery\_level(v\_new\_score);

  insert into public.student\_skill\_mastery (  
    user\_id,  
    section,  
    domain,  
    skill,  
    attempts,  
    correct,  
    accuracy,  
    last\_attempt\_at,  
    mastery\_score,  
    mastery\_pct,  
    mastery\_level,  
    created\_at,  
    updated\_at  
  )  
  values (  
    p\_student\_id,  
    p\_section,  
    p\_domain,  
    p\_skill,  
    v\_new\_attempts,  
    v\_new\_correct,  
    v\_new\_accuracy,  
    p\_occurred\_at,  
    v\_new\_score,  
    v\_new\_pct,  
    v\_new\_level,  
    now(),  
    now()  
  )  
  on conflict (user\_id, section, domain, skill) do update  
  set attempts \= excluded.attempts,  
      correct \= excluded.correct,  
      accuracy \= excluded.accuracy,  
      last\_attempt\_at \= excluded.last\_attempt\_at,  
      mastery\_score \= excluded.mastery\_score,  
      mastery\_pct \= excluded.mastery\_pct,  
      mastery\_level \= excluded.mastery\_level,  
      updated\_at \= now();

  perform public.refresh\_domain\_mastery\_for\_student\_domain(p\_student\_id, p\_domain);  
  perform public.refresh\_section\_projection\_for\_student\_section(p\_student\_id, p\_section);

  select \*  
    into v\_domain\_row  
  from public.student\_domain\_mastery  
  where student\_id \= p\_student\_id  
    and domain \= p\_domain;

  select \*  
    into v\_section\_projection  
  from public.student\_section\_projections  
  where student\_id \= p\_student\_id  
    and section \= p\_section;

  return jsonb\_build\_object(  
    'skill\_mastery', jsonb\_build\_object(  
      'student\_id', p\_student\_id,  
      'section', p\_section,  
      'domain', p\_domain,  
      'skill', p\_skill,  
      'mastery\_score', v\_new\_score,  
      'mastery\_pct', v\_new\_pct,  
      'mastery\_level', v\_new\_level,  
      'attempts', v\_new\_attempts,  
      'correct', v\_new\_correct,  
      'accuracy', v\_new\_accuracy  
    ),  
    'domain\_mastery', case  
      when v\_domain\_row.student\_id is null then null  
      else jsonb\_build\_object(  
        'student\_id', v\_domain\_row.student\_id,  
        'section', v\_domain\_row.section,  
        'domain', v\_domain\_row.domain,  
        'mastery\_score', v\_domain\_row.mastery\_score,  
        'mastery\_pct', v\_domain\_row.mastery\_pct,  
        'mastery\_level', v\_domain\_row.mastery\_level,  
        'questions\_total', v\_domain\_row.questions\_total,  
        'questions\_correct', v\_domain\_row.questions\_correct,  
        'questions\_incorrect', v\_domain\_row.questions\_incorrect  
      )  
    end,  
    'section\_projection', case  
      when v\_section\_projection.student\_id is null then null  
      else jsonb\_build\_object(  
        'student\_id', v\_section\_projection.student\_id,  
        'section', v\_section\_projection.section,  
        'projected\_score\_mid', v\_section\_projection.projected\_score\_mid,  
        'projected\_score\_low', v\_section\_projection.projected\_score\_low,  
        'projected\_score\_high', v\_section\_projection.projected\_score\_high,  
        'range\_width', v\_section\_projection.range\_width,  
        'relevant\_question\_count', v\_section\_projection.relevant\_question\_count  
      )  
    end  
  );  
end;  
$function$  
 |  
| public      | audit\_kpi\_constants\_changes                    |                                                                                                                                                                                             |                                                                                                                                                                                                                                 | trigger                      | plpgsql  | false            | v          | u               | CREATE OR REPLACE FUNCTION public.audit\_kpi\_constants\_changes()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
begin  
  if tg\_op \= 'UPDATE' then  
    insert into public.constants\_audit\_log (  
      constant\_table,  
      constant\_key,  
      old\_value\_json,  
      new\_value\_json,  
      changed\_by,  
      change\_reason  
    )  
    values (  
      'kpi\_constants',  
      old.version,  
      to\_jsonb(old),  
      to\_jsonb(new),  
      null,  
      null  
    );  
  end if;

  return new;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |  
| public      | audit\_mastery\_constants\_changes                |                                                                                                                                                                                             |                                                                                                                                                                                                                                 | trigger                      | plpgsql  | false            | v          | u               | CREATE OR REPLACE FUNCTION public.audit\_mastery\_constants\_changes()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
begin  
  if tg\_op \= 'UPDATE' then  
    insert into public.constants\_audit\_log (  
      constant\_table,  
      constant\_key,  
      old\_value\_json,  
      new\_value\_json,  
      changed\_by,  
      change\_reason  
    )  
    values (  
      'mastery\_constants',  
      old.key,  
      jsonb\_build\_object(  
        'value\_num', old.value\_num,  
        'value\_text', old.value\_text,  
        'value\_json', old.value\_json,  
        'units', old.units,  
        'description', old.description,  
        'formula\_ref', old.formula\_ref,  
        'updated\_at', old.updated\_at  
      ),  
      jsonb\_build\_object(  
        'value\_num', new.value\_num,  
        'value\_text', new.value\_text,  
        'value\_json', new.value\_json,  
        'units', new.units,  
        'description', new.description,  
        'formula\_ref', new.formula\_ref,  
        'updated\_at', new.updated\_at  
      ),  
      null,  
      null  
    );  
  end if;

  return new;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |  
| public      | compute\_projection\_delta                       | p\_relevant\_question\_count integer                                                                                                                                                           | p\_relevant\_question\_count integer                                                                                                                                                                                               | integer                      | plpgsql  | false            | s          | u               | CREATE OR REPLACE FUNCTION public.compute\_projection\_delta(p\_relevant\_question\_count integer)  
 RETURNS integer  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  v\_cfg public.kpi\_constants;  
  v\_target integer;  
  v\_min\_delta integer;  
  v\_max\_delta integer;  
  v\_progress numeric;  
  v\_delta numeric;  
begin  
  v\_cfg := public.get\_kpi\_live\_row();

  if v\_cfg.version is null then  
    raise exception 'Missing live row in kpi\_constants';  
  end if;

  v\_target := coalesce((v\_cfg.thresholds \-\>\> 'projection\_target\_questions')::integer, 1000);  
  v\_min\_delta := coalesce((v\_cfg.thresholds \-\>\> 'projection\_min\_delta')::integer, 20);  
  v\_max\_delta := coalesce((v\_cfg.thresholds \-\>\> 'projection\_max\_delta')::integer, 60);

  if v\_target \<= 0 then  
    raise exception 'projection\_target\_questions must be \> 0';  
  end if;

  v\_progress := least(1.0, greatest(0.0, p\_relevant\_question\_count::numeric / v\_target::numeric));  
  v\_delta := v\_max\_delta \- (v\_progress \* (v\_max\_delta \- v\_min\_delta));

  return greatest(v\_min\_delta, floor(v\_delta)::integer);  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |  
| public      | get\_base\_delta                                 | p\_source\_family text, p\_correct boolean                                                                                                                                                     | p\_source\_family text, p\_correct boolean                                                                                                                                                                                         | numeric                      | plpgsql  | false            | s          | u               | CREATE OR REPLACE FUNCTION public.get\_base\_delta(p\_source\_family text, p\_correct boolean)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  v\_key text;  
begin  
  if p\_source\_family not in ('practice', 'review', 'test') then  
    raise exception 'Invalid source\_family: %', p\_source\_family;  
  end if;

  v\_key := case  
    when p\_source\_family \= 'practice' and p\_correct then 'delta\_practice\_correct'  
    when p\_source\_family \= 'practice' and not p\_correct then 'delta\_practice\_incorrect'  
    when p\_source\_family \= 'review' and p\_correct then 'delta\_review\_correct'  
    when p\_source\_family \= 'review' and not p\_correct then 'delta\_review\_incorrect'  
    when p\_source\_family \= 'test' and p\_correct then 'delta\_test\_correct'  
    when p\_source\_family \= 'test' and not p\_correct then 'delta\_test\_incorrect'  
  end;

  return public.get\_mastery\_constant\_num(v\_key);  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |  
| public      | get\_difficulty\_multiplier                      | p\_bucket integer                                                                                                                                                                            | p\_bucket integer                                                                                                                                                                                                                | numeric                      | plpgsql  | false            | s          | u               | CREATE OR REPLACE FUNCTION public.get\_difficulty\_multiplier(p\_bucket integer)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  v\_key text;  
begin  
  v\_key := case public.normalize\_difficulty\_bucket(p\_bucket)  
    when 1 then 'difficulty\_multiplier\_easy'  
    when 2 then 'difficulty\_multiplier\_medium'  
    when 3 then 'difficulty\_multiplier\_hard'  
  end;

  return public.get\_mastery\_constant\_num(v\_key);  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |  
| public      | get\_kpi\_live\_row                               |                                                                                                                                                                                             |                                                                                                                                                                                                                                 | kpi\_constants                | sql      | false            | s          | u               | CREATE OR REPLACE FUNCTION public.get\_kpi\_live\_row()  
 RETURNS kpi\_constants  
 LANGUAGE sql  
 STABLE  
AS $function$  
  select \*  
  from public.kpi\_constants  
  where version \= 'live'  
  limit 1;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |  
| public      | get\_mastery\_constant\_num                       | p\_key text                                                                                                                                                                                  | p\_key text                                                                                                                                                                                                                      | numeric                      | plpgsql  | false            | s          | u               | CREATE OR REPLACE FUNCTION public.get\_mastery\_constant\_num(p\_key text)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  v\_value numeric;  
begin  
  select value\_num  
    into v\_value  
  from public.mastery\_constants  
  where key \= p\_key;

  if v\_value is null then  
    raise exception 'Missing numeric mastery constant: %', p\_key;  
  end if;

  return v\_value;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |  
| public      | map\_mastery\_level                              | p\_score numeric                                                                                                                                                                             | p\_score numeric                                                                                                                                                                                                                 | integer                      | plpgsql  | false            | s          | u               | CREATE OR REPLACE FUNCTION public.map\_mastery\_level(p\_score numeric)  
 RETURNS integer  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  v\_l0\_max numeric := public.get\_mastery\_constant\_num('mastery\_level\_0\_max');  
  v\_l1\_max numeric := public.get\_mastery\_constant\_num('mastery\_level\_1\_max');  
  v\_l2\_max numeric := public.get\_mastery\_constant\_num('mastery\_level\_2\_max');  
  v\_l3\_max numeric := public.get\_mastery\_constant\_num('mastery\_level\_3\_max');  
begin  
  if p\_score \<= v\_l0\_max then  
    return 0;  
  elsif p\_score \<= v\_l1\_max then  
    return 1;  
  elsif p\_score \<= v\_l2\_max then  
    return 2;  
  elsif p\_score \<= v\_l3\_max then  
    return 3;  
  else  
    return 4;  
  end if;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |  
| public      | normalize\_difficulty\_bucket                    | p\_bucket integer                                                                                                                                                                            | p\_bucket integer                                                                                                                                                                                                                | integer                      | plpgsql  | false            | i          | u               | CREATE OR REPLACE FUNCTION public.normalize\_difficulty\_bucket(p\_bucket integer)  
 RETURNS integer  
 LANGUAGE plpgsql  
 IMMUTABLE  
AS $function$  
begin  
  if p\_bucket not in (1, 2, 3\) then  
    raise exception 'Invalid difficulty bucket %. Expected 1, 2, or 3.', p\_bucket;  
  end if;  
  return p\_bucket;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |  
| public      | normalize\_difficulty\_bucket\_from\_jsonb         | p\_value jsonb                                                                                                                                                                               | p\_value jsonb                                                                                                                                                                                                                   | integer                      | plpgsql  | false            | i          | u               | CREATE OR REPLACE FUNCTION public.normalize\_difficulty\_bucket\_from\_jsonb(p\_value jsonb)  
 RETURNS integer  
 LANGUAGE plpgsql  
 IMMUTABLE  
AS $function$  
declare  
  v\_text text;  
  v\_int integer;  
begin  
  if p\_value is null then  
    raise exception 'Difficulty jsonb is null';  
  end if;

  if jsonb\_typeof(p\_value) \= 'number' then  
    v\_text := trim(both '"' from p\_value::text);  
  elsif jsonb\_typeof(p\_value) \= 'string' then  
    v\_text := trim(both '"' from p\_value::text);  
  else  
    raise exception 'Unsupported difficulty jsonb shape: %', p\_value::text;  
  end if;

  begin  
    v\_int := v\_text::integer;  
  exception when others then  
    raise exception 'Could not parse difficulty jsonb value into integer bucket: %', p\_value::text;  
  end;

  return public.normalize\_difficulty\_bucket(v\_int);  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |  
| public      | rebuild\_mastery\_and\_kpis                       | p\_student\_id uuid                                                                                                                                                                           | p\_student\_id uuid DEFAULT NULL::uuid                                                                                                                                                                                            | void                         | plpgsql  | true             | v          | u               | CREATE OR REPLACE FUNCTION public.rebuild\_mastery\_and\_kpis(p\_student\_id uuid DEFAULT NULL::uuid)  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
declare  
  r record;  
begin  
  \-- wipe canonical derived state for the target student(s)  
  if p\_student\_id is null then  
    truncate table public.student\_kpi\_rollups\_current;  
    truncate table public.student\_domain\_mastery;  
    truncate table public.student\_section\_projections;

    update public.student\_skill\_mastery  
    set attempts \= 0,  
        correct \= 0,  
        accuracy \= 0,  
        mastery\_score \= 0.0,  
        mastery\_pct \= 0.0,  
        mastery\_level \= 0,  
        last\_attempt\_at \= null,  
        updated\_at \= now();  
  else  
    delete from public.student\_kpi\_rollups\_current where student\_id \= p\_student\_id;  
    delete from public.student\_domain\_mastery where student\_id \= p\_student\_id;  
    delete from public.student\_section\_projections where student\_id \= p\_student\_id;

    update public.student\_skill\_mastery  
    set attempts \= 0,  
        correct \= 0,  
        accuracy \= 0,  
        mastery\_score \= 0.0,  
        mastery\_pct \= 0.0,  
        mastery\_level \= 0,  
        last\_attempt\_at \= null,  
        updated\_at \= now()  
    where user\_id \= p\_student\_id;  
  end if;

  \-- PRACTICE REPLAY  
  for r in  
    select  
      psi.user\_id as student\_id,  
      psi.question\_section as section,  
      psi.question\_domain as domain,  
      psi.question\_skill as skill,  
      public.normalize\_difficulty\_bucket(psi.question\_difficulty) as difficulty\_bucket,  
      'practice'::text as source\_family,  
      pav0.is\_correct as correct,  
      null::integer as latency\_ms,  
      coalesce(psi.answered\_at, pav0.created\_at, psi.updated\_at, psi.created\_at) as occurred\_at  
    from public.practice\_session\_items psi  
    join public.practice\_attempts\_v0 pav0  
      on pav0.id \= psi.attempt\_id  
    where psi.attempt\_id is not null  
      and pav0.is\_correct is not null  
      and psi.question\_domain is not null  
      and psi.question\_skill is not null  
      and psi.question\_section in ('M', 'RW')  
      and psi.question\_difficulty in (1, 2, 3\)  
      and (p\_student\_id is null or psi.user\_id \= p\_student\_id)  
    order by coalesce(psi.answered\_at, pav0.created\_at, psi.updated\_at, psi.created\_at), psi.id  
  loop  
    perform public.apply\_learning\_event\_to\_mastery(  
      r.student\_id,  
      r.section,  
      r.domain,  
      r.skill,  
      r.difficulty\_bucket,  
      r.source\_family,  
      r.correct,  
      r.latency\_ms,  
      r.occurred\_at  
    );  
  end loop;

  \-- REVIEW REPLAY  
  for r in  
    select  
      rsi.student\_id as student\_id,  
      rsi.question\_section as section,  
      rsi.question\_domain as domain,  
      rsi.question\_skill as skill,  
      public.normalize\_difficulty\_bucket\_from\_jsonb(rsi.question\_difficulty) as difficulty\_bucket,  
      'review'::text as source\_family,  
      rea.is\_correct as correct,  
      case  
        when rea.seconds\_spent is null then null  
        else rea.seconds\_spent \* 1000  
      end as latency\_ms,  
      coalesce(rsi.answered\_at, rea.created\_at, rsi.updated\_at, rsi.created\_at) as occurred\_at  
    from public.review\_session\_items rsi  
    join public.review\_error\_attempts rea  
      on rea.id \= rsi.attempt\_id  
    where rsi.attempt\_id is not null  
      and rsi.question\_domain is not null  
      and rsi.question\_skill is not null  
      and rsi.question\_section in ('M', 'RW')  
      and (p\_student\_id is null or rsi.student\_id \= p\_student\_id)  
    order by coalesce(rsi.answered\_at, rea.created\_at, rsi.updated\_at, rsi.created\_at), rsi.id  
  loop  
    perform public.apply\_learning\_event\_to\_mastery(  
      r.student\_id,  
      r.section,  
      r.domain,  
      r.skill,  
      r.difficulty\_bucket,  
      r.source\_family,  
      r.correct,  
      r.latency\_ms,  
      r.occurred\_at  
    );  
  end loop;

  \-- FULL-LENGTH REPLAY  
  for r in  
    select  
      fles.user\_id as student\_id,  
      coalesce(fleq.question\_section\_code, fleq.question\_section) as section,  
      fleq.question\_domain as domain,  
      fleq.question\_skill as skill,  
      public.normalize\_difficulty\_bucket(fleq.question\_difficulty) as difficulty\_bucket,  
      'test'::text as source\_family,  
      fer.is\_correct as correct,  
      null::integer as latency\_ms,  
      coalesce(fer.answered\_at, fer.submitted\_at, fer.updated\_at, fer.created\_at) as occurred\_at  
    from public.full\_length\_exam\_responses fer  
    join public.full\_length\_exam\_questions fleq  
      on fleq.module\_id \= fer.module\_id  
     and fleq.question\_id \= fer.question\_id  
    join public.full\_length\_exam\_sessions fles  
      on fles.id \= fer.session\_id  
    where fer.is\_correct is not null  
      and fleq.question\_domain is not null  
      and fleq.question\_skill is not null  
      and coalesce(fleq.question\_section\_code, fleq.question\_section) in ('M', 'RW')  
      and fleq.question\_difficulty in (1, 2, 3\)  
      and (p\_student\_id is null or fles.user\_id \= p\_student\_id)  
    order by coalesce(fer.answered\_at, fer.submitted\_at, fer.updated\_at, fer.created\_at), fer.id  
  loop  
    perform public.apply\_learning\_event\_to\_mastery(  
      r.student\_id,  
      r.section,  
      r.domain,  
      r.skill,  
      r.difficulty\_bucket,  
      r.source\_family,  
      r.correct,  
      r.latency\_ms,  
      r.occurred\_at  
    );  
  end loop;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |  
| public      | refresh\_domain\_mastery\_for\_student\_domain      | p\_student\_id uuid, p\_domain text                                                                                                                                                            | p\_student\_id uuid, p\_domain text                                                                                                                                                                                                | void                         | plpgsql  | false            | v          | u               | CREATE OR REPLACE FUNCTION public.refresh\_domain\_mastery\_for\_student\_domain(p\_student\_id uuid, p\_domain text)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
declare  
  v\_section text;  
begin  
  select ssm.section  
    into v\_section  
  from public.student\_skill\_mastery ssm  
  where ssm.user\_id \= p\_student\_id  
    and ssm.domain \= p\_domain  
  order by ssm.updated\_at desc  
  limit 1;

  if v\_section is null then  
    delete from public.student\_domain\_mastery  
    where student\_id \= p\_student\_id  
      and domain \= p\_domain;  
    return;  
  end if;

  insert into public.student\_domain\_mastery (  
    student\_id,  
    section,  
    domain,  
    skills\_total,  
    questions\_total,  
    questions\_correct,  
    questions\_incorrect,  
    mastery\_score,  
    mastery\_pct,  
    mastery\_level,  
    last\_attempt\_at,  
    created\_at,  
    updated\_at  
  )  
  select  
    p\_student\_id,  
    v\_section,  
    p\_domain,  
    count(\*)::integer,  
    coalesce(sum(ssm.attempts), 0)::integer,  
    coalesce(sum(ssm.correct), 0)::integer,  
    coalesce(sum(ssm.attempts \- ssm.correct), 0)::integer,  
    case  
      when coalesce(sum(ssm.attempts), 0\) \= 0 then 0  
      else coalesce(sum(ssm.mastery\_score \* ssm.attempts), 0\) / nullif(sum(ssm.attempts), 0\)  
    end,  
    round((  
      case  
        when coalesce(sum(ssm.attempts), 0\) \= 0 then 0  
        else coalesce(sum(ssm.mastery\_score \* ssm.attempts), 0\) / nullif(sum(ssm.attempts), 0\)  
      end  
    ) \* 100.0, 2),  
    public.map\_mastery\_level(  
      case  
        when coalesce(sum(ssm.attempts), 0\) \= 0 then 0  
        else coalesce(sum(ssm.mastery\_score \* ssm.attempts), 0\) / nullif(sum(ssm.attempts), 0\)  
      end  
    ),  
    max(ssm.last\_attempt\_at),  
    now(),  
    now()  
  from public.student\_skill\_mastery ssm  
  where ssm.user\_id \= p\_student\_id  
    and ssm.domain \= p\_domain  
  group by p\_student\_id, v\_section, p\_domain  
  on conflict (student\_id, domain) do update  
  set section \= excluded.section,  
      skills\_total \= excluded.skills\_total,  
      questions\_total \= excluded.questions\_total,  
      questions\_correct \= excluded.questions\_correct,  
      questions\_incorrect \= excluded.questions\_incorrect,  
      mastery\_score \= excluded.mastery\_score,  
      mastery\_pct \= excluded.mastery\_pct,  
      mastery\_level \= excluded.mastery\_level,  
      last\_attempt\_at \= excluded.last\_attempt\_at,  
      updated\_at \= now();  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |  
| public      | refresh\_section\_projection\_for\_student\_section | p\_student\_id uuid, p\_section text                                                                                                                                                           | p\_student\_id uuid, p\_section text                                                                                                                                                                                               | void                         | plpgsql  | false            | v          | u               | CREATE OR REPLACE FUNCTION public.refresh\_section\_projection\_for\_student\_section(p\_student\_id uuid, p\_section text)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
declare  
  v\_cfg public.kpi\_constants;  
  v\_weights jsonb;  
  v\_section\_weights jsonb;  
  v\_section\_max integer;  
  v\_midpoint numeric := 0;  
  v\_questions integer := 0;  
  v\_delta integer := 60;  
  v\_low integer := 0;  
  v\_high integer := 0;  
  v\_round\_mid integer := 5;  
  v\_round\_bound integer := 10;  
  v\_domain\_record record;  
  v\_weight numeric;  
begin  
  v\_cfg := public.get\_kpi\_live\_row();

  if v\_cfg.version is null then  
    raise exception 'Missing live row in kpi\_constants';  
  end if;

  v\_weights := v\_cfg.weights;

  if p\_section \= 'M' then  
    v\_section\_max := coalesce((v\_cfg.score\_bands \-\> 'section\_max\_scores' \-\>\> 'M')::integer, 800);  
    v\_section\_weights := v\_weights \-\> 'math';  
  elsif p\_section \= 'RW' then  
    v\_section\_max := coalesce((v\_cfg.score\_bands \-\> 'section\_max\_scores' \-\>\> 'RW')::integer, 800);  
    v\_section\_weights := v\_weights \-\> 'rw';  
  else  
    raise exception 'Invalid section %', p\_section;  
  end if;

  v\_round\_mid := coalesce((v\_cfg.scaling\_constants \-\>\> 'midpoint\_round\_to')::integer, 5);  
  v\_round\_bound := coalesce((v\_cfg.scaling\_constants \-\>\> 'bound\_round\_to')::integer, 10);

  for v\_domain\_record in  
    select domain, mastery\_score, questions\_total  
    from public.student\_domain\_mastery  
    where student\_id \= p\_student\_id  
      and section \= p\_section  
  loop  
    v\_weight := coalesce((v\_section\_weights \-\>\> v\_domain\_record.domain)::numeric, 0);  
    v\_midpoint := v\_midpoint \+ (coalesce(v\_domain\_record.mastery\_score, 0\) \* v\_weight \* v\_section\_max);  
    v\_questions := v\_questions \+ coalesce(v\_domain\_record.questions\_total, 0);  
  end loop;

  v\_midpoint := public.round\_to\_nearest(v\_midpoint, v\_round\_mid);  
  v\_delta := public.compute\_projection\_delta(v\_questions);  
  v\_low := public.round\_to\_nearest(v\_midpoint \- v\_delta, v\_round\_bound);  
  v\_high := public.round\_to\_nearest(v\_midpoint \+ v\_delta, v\_round\_bound);

  insert into public.student\_section\_projections (  
    student\_id,  
    section,  
    projected\_score\_mid,  
    projected\_score\_low,  
    projected\_score\_high,  
    range\_width,  
    relevant\_question\_count,  
    created\_at,  
    updated\_at  
  )  
  values (  
    p\_student\_id,  
    p\_section,  
    v\_midpoint::integer,  
    greatest(0, v\_low),  
    least(v\_section\_max, v\_high),  
    (v\_delta \* 2),  
    v\_questions,  
    now(),  
    now()  
  )  
  on conflict (student\_id, section) do update  
  set projected\_score\_mid \= excluded.projected\_score\_mid,  
      projected\_score\_low \= excluded.projected\_score\_low,  
      projected\_score\_high \= excluded.projected\_score\_high,  
      range\_width \= excluded.range\_width,  
      relevant\_question\_count \= excluded.relevant\_question\_count,  
      updated\_at \= now();  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |  
| public      | round\_to\_nearest                               | p\_value numeric, p\_step integer                                                                                                                                                             | p\_value numeric, p\_step integer                                                                                                                                                                                                 | integer                      | sql      | false            | i          | u               | CREATE OR REPLACE FUNCTION public.round\_to\_nearest(p\_value numeric, p\_step integer)  
 RETURNS integer  
 LANGUAGE sql  
 IMMUTABLE  
AS $function$  
  select cast(round(p\_value / p\_step) \* p\_step as integer);  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |  
| public      | upsert\_cluster\_mastery                         | p\_user\_id uuid, p\_structure\_cluster\_id uuid, p\_is\_correct boolean, p\_event\_weight numeric                                                                                                   | p\_user\_id uuid, p\_structure\_cluster\_id uuid, p\_is\_correct boolean, p\_event\_weight numeric DEFAULT 1.0                                                                                                                           | void                         | plpgsql  | true             | v          | u               | CREATE OR REPLACE FUNCTION public.upsert\_cluster\_mastery(p\_user\_id uuid, p\_structure\_cluster\_id uuid, p\_is\_correct boolean, p\_event\_weight numeric DEFAULT 1.0)  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  v\_half\_life\_days numeric;  
  v\_alpha0 numeric;  
  v\_beta0 numeric;

  v\_existing\_attempts numeric;  
  v\_existing\_correct numeric;  
  v\_last\_updated\_at timestamptz;

  v\_dt\_seconds numeric;  
  v\_dt\_days numeric;  
  v\_decay numeric;

  v\_E numeric;  
  v\_C numeric;  
  v\_p numeric;  
  v\_mastery\_score numeric;

  v\_question\_weight numeric := 1.0;  
begin  
  select value\_num into v\_half\_life\_days from public.mastery\_constants where key \= 'HALF\_LIFE\_DAYS';  
  select value\_num into v\_alpha0 from public.mastery\_constants where key \= 'ALPHA0';  
  select value\_num into v\_beta0 from public.mastery\_constants where key \= 'BETA0';

  if v\_half\_life\_days is null or v\_alpha0 is null or v\_beta0 is null then  
    raise exception 'Missing mastery\_constants required keys (HALF\_LIFE\_DAYS, ALPHA0, BETA0)';  
  end if;

  select attempts, correct, updated\_at  
    into v\_existing\_attempts, v\_existing\_correct, v\_last\_updated\_at  
  from public.student\_cluster\_mastery  
  where user\_id \= p\_user\_id  
    and structure\_cluster\_id \= p\_structure\_cluster\_id;

  if v\_existing\_attempts is null then  
    v\_existing\_attempts := 0;  
    v\_existing\_correct := 0;  
    v\_last\_updated\_at := now();  
  end if;

  v\_dt\_seconds := extract(epoch from (now() \- v\_last\_updated\_at));  
  v\_dt\_days := v\_dt\_seconds / 86400.0;  
  v\_decay := power(0.5, v\_dt\_days / v\_half\_life\_days);

  v\_E := (v\_existing\_attempts \* v\_decay) \+ (p\_event\_weight \* v\_question\_weight);  
  v\_C := (v\_existing\_correct \* v\_decay) \+ (p\_event\_weight \* v\_question\_weight \* case when p\_is\_correct then 1 else 0 end);

  v\_p := (v\_C \+ v\_alpha0) / (v\_E \+ v\_alpha0 \+ v\_alpha0 \+ v\_beta0 \- v\_alpha0); \-- simplified next line below  
  v\_p := (v\_C \+ v\_alpha0) / (v\_E \+ v\_alpha0 \+ v\_beta0);

  v\_mastery\_score := round(100.0 \* v\_p, 2);

  insert into public.student\_cluster\_mastery (  
    user\_id, structure\_cluster\_id,  
    attempts, correct, accuracy, mastery\_score,  
    last\_attempt\_at, updated\_at  
  ) values (  
    p\_user\_id,  
    p\_structure\_cluster\_id,  
    v\_E,  
    v\_C,  
    v\_p,  
    v\_mastery\_score,  
    now(),  
    now()  
  )  
  on conflict (user\_id, structure\_cluster\_id) do update set  
    attempts \= excluded.attempts,  
    correct \= excluded.correct,  
    accuracy \= excluded.accuracy,  
    mastery\_score \= excluded.mastery\_score,  
    last\_attempt\_at \= excluded.last\_attempt\_at,  
    updated\_at \= excluded.updated\_at;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |  
| public      | upsert\_skill\_mastery                           | p\_user\_id uuid, p\_section character varying, p\_domain character varying, p\_skill character varying, p\_is\_correct boolean, p\_event\_weight numeric                                            | p\_user\_id uuid, p\_section character varying, p\_domain character varying, p\_skill character varying, p\_is\_correct boolean, p\_event\_weight numeric DEFAULT 1.0                                                                    | void                         | plpgsql  | true             | v          | u               | CREATE OR REPLACE FUNCTION public.upsert\_skill\_mastery(p\_user\_id uuid, p\_section character varying, p\_domain character varying, p\_skill character varying, p\_is\_correct boolean, p\_event\_weight numeric DEFAULT 1.0)  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  v\_half\_life\_days numeric;  
  v\_alpha0 numeric;  
  v\_beta0 numeric;

  v\_existing\_attempts numeric;  
  v\_existing\_correct numeric;  
  v\_last\_updated\_at timestamptz;

  v\_dt\_seconds numeric;  
  v\_dt\_days numeric;  
  v\_decay numeric;

  v\_E numeric;  
  v\_C numeric;  
  v\_p numeric;  
  v\_mastery\_score numeric;

  v\_question\_weight numeric := 1.0;  
begin  
  select value\_num into v\_half\_life\_days from public.mastery\_constants where key \= 'HALF\_LIFE\_DAYS';  
  select value\_num into v\_alpha0 from public.mastery\_constants where key \= 'ALPHA0';  
  select value\_num into v\_beta0 from public.mastery\_constants where key \= 'BETA0';

  if v\_half\_life\_days is null or v\_alpha0 is null or v\_beta0 is null then  
    raise exception 'Missing mastery\_constants required keys (HALF\_LIFE\_DAYS, ALPHA0, BETA0)';  
  end if;

  select attempts, correct, updated\_at  
    into v\_existing\_attempts, v\_existing\_correct, v\_last\_updated\_at  
  from public.student\_skill\_mastery  
  where user\_id \= p\_user\_id  
    and section \= p\_section  
    and domain \= coalesce(p\_domain, 'unknown')  
    and skill \= p\_skill;

  if v\_existing\_attempts is null then  
    v\_existing\_attempts := 0;  
    v\_existing\_correct := 0;  
    v\_last\_updated\_at := now();  
  end if;

  v\_dt\_seconds := extract(epoch from (now() \- v\_last\_updated\_at));  
  v\_dt\_days := v\_dt\_seconds / 86400.0;  
  v\_decay := power(0.5, v\_dt\_days / v\_half\_life\_days);

  v\_E := (v\_existing\_attempts \* v\_decay) \+ (p\_event\_weight \* v\_question\_weight);  
  v\_C := (v\_existing\_correct \* v\_decay) \+ (p\_event\_weight \* v\_question\_weight \* case when p\_is\_correct then 1 else 0 end);

  v\_p := (v\_C \+ v\_alpha0) / (v\_E \+ v\_alpha0 \+ v\_beta0);  
  v\_mastery\_score := round(100.0 \* v\_p, 2);

  insert into public.student\_skill\_mastery (  
    user\_id, section, domain, skill,  
    attempts, correct, accuracy, mastery\_score,  
    last\_attempt\_at, updated\_at  
  ) values (  
    p\_user\_id,  
    p\_section,  
    coalesce(p\_domain, 'unknown'),  
    p\_skill,  
    v\_E,  
    v\_C,  
    v\_p,  
    v\_mastery\_score,  
    now(),  
    now()  
  )  
  on conflict (user\_id, section, domain, skill) do update set  
    attempts \= excluded.attempts,  
    correct \= excluded.correct,  
    accuracy \= excluded.accuracy,  
    mastery\_score \= excluded.mastery\_score,  
    last\_attempt\_at \= excluded.last\_attempt\_at,  
    updated\_at \= excluded.updated\_at;  
end;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |  
| public      | upsert\_student\_kpi\_counters\_current            | p\_user\_id uuid, p\_event\_type text, p\_is\_correct boolean, p\_section text, p\_domain\_prefix text, p\_skill\_prefix text, p\_event\_id text, p\_source\_version text                                  | p\_user\_id uuid, p\_event\_type text, p\_is\_correct boolean, p\_section text, p\_domain\_prefix text, p\_skill\_prefix text, p\_event\_id text DEFAULT NULL::text, p\_source\_version text DEFAULT 'kpi\_truth\_v1'::text                      | student\_kpi\_counters\_current | plpgsql  | true             | v          | u               | CREATE OR REPLACE FUNCTION public.upsert\_student\_kpi\_counters\_current(p\_user\_id uuid, p\_event\_type text, p\_is\_correct boolean, p\_section text, p\_domain\_prefix text, p\_skill\_prefix text, p\_event\_id text DEFAULT NULL::text, p\_source\_version text DEFAULT 'kpi\_truth\_v1'::text)  
 RETURNS student\_kpi\_counters\_current  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_section TEXT := LOWER(COALESCE(p\_section, ''));  
  v\_source\_prefix TEXT;  
  v\_domain\_prefix TEXT := LOWER(COALESCE(p\_domain\_prefix, ''));  
  v\_skill\_prefix TEXT := LOWER(COALESCE(p\_skill\_prefix, ''));  
  v\_sql TEXT;  
  v\_row public.student\_kpi\_counters\_current;  
BEGIN  
  IF p\_user\_id IS NULL THEN  
    RAISE EXCEPTION 'p\_user\_id is required';  
  END IF;

  IF v\_section NOT IN ('math', 'rw') THEN  
    RAISE EXCEPTION 'p\_section must be math or rw';  
  END IF;

  IF v\_domain\_prefix \!\~ '^\[a-z0-9\_\]+$' THEN  
    RAISE EXCEPTION 'Invalid domain prefix: %', p\_domain\_prefix;  
  END IF;

  IF v\_skill\_prefix \!\~ '^\[a-z0-9\_\]+$' THEN  
    RAISE EXCEPTION 'Invalid skill prefix: %', p\_skill\_prefix;  
  END IF;

  CASE LOWER(COALESCE(p\_event\_type, ''))  
    WHEN 'practice\_pass' THEN v\_source\_prefix := 'practice';  
    WHEN 'practice\_fail' THEN v\_source\_prefix := 'practice';  
    WHEN 'review\_pass' THEN v\_source\_prefix := 'review';  
    WHEN 'review\_fail' THEN v\_source\_prefix := 'review';  
    WHEN 'test\_pass' THEN v\_source\_prefix := 'full\_length';  
    WHEN 'test\_fail' THEN v\_source\_prefix := 'full\_length';  
    WHEN 'tutor\_helped' THEN v\_source\_prefix := 'flowcard';  
    WHEN 'tutor\_fail' THEN v\_source\_prefix := 'flowcard';  
    ELSE v\_source\_prefix := NULL;  
  END CASE;

  INSERT INTO public.student\_kpi\_counters\_current (user\_id)  
  VALUES (p\_user\_id)  
  ON CONFLICT (user\_id) DO NOTHING;

  v\_sql :=  
    'UPDATE public.student\_kpi\_counters\_current SET ' ||  
    'total\_answered\_count \= total\_answered\_count \+ 1, ' ||  
    'total\_correct\_count \= total\_correct\_count \+ CASE WHEN $2 THEN 1 ELSE 0 END, ' ||  
    'total\_wrong\_count \= total\_wrong\_count \+ CASE WHEN $2 THEN 0 ELSE 1 END, ' ||  
    quote\_ident(v\_section || '\_answered\_count') || ' \= ' || quote\_ident(v\_section || '\_answered\_count') || ' \+ 1, ' ||  
    quote\_ident(v\_section || '\_correct\_count') || ' \= ' || quote\_ident(v\_section || '\_correct\_count') || ' \+ CASE WHEN $2 THEN 1 ELSE 0 END, ' ||  
    quote\_ident(v\_section || '\_wrong\_count') || ' \= ' || quote\_ident(v\_section || '\_wrong\_count') || ' \+ CASE WHEN $2 THEN 0 ELSE 1 END, ' ||  
    quote\_ident(v\_domain\_prefix || '\_answered\_count') || ' \= ' || quote\_ident(v\_domain\_prefix || '\_answered\_count') || ' \+ 1, ' ||  
    quote\_ident(v\_domain\_prefix || '\_correct\_count') || ' \= ' || quote\_ident(v\_domain\_prefix || '\_correct\_count') || ' \+ CASE WHEN $2 THEN 1 ELSE 0 END, ' ||  
    quote\_ident(v\_domain\_prefix || '\_wrong\_count') || ' \= ' || quote\_ident(v\_domain\_prefix || '\_wrong\_count') || ' \+ CASE WHEN $2 THEN 0 ELSE 1 END, ' ||  
    quote\_ident(v\_skill\_prefix || '\_answered\_count') || ' \= ' || quote\_ident(v\_skill\_prefix || '\_answered\_count') || ' \+ 1, ' ||  
    quote\_ident(v\_skill\_prefix || '\_correct\_count') || ' \= ' || quote\_ident(v\_skill\_prefix || '\_correct\_count') || ' \+ CASE WHEN $2 THEN 1 ELSE 0 END, ' ||  
    quote\_ident(v\_skill\_prefix || '\_wrong\_count') || ' \= ' || quote\_ident(v\_skill\_prefix || '\_wrong\_count') || ' \+ CASE WHEN $2 THEN 0 ELSE 1 END';

  IF v\_source\_prefix IS NOT NULL THEN  
    v\_sql := v\_sql || ', ' ||  
      quote\_ident(v\_source\_prefix || '\_answered\_count') || ' \= ' || quote\_ident(v\_source\_prefix || '\_answered\_count') || ' \+ 1, ' ||  
      quote\_ident(v\_source\_prefix || '\_correct\_count') || ' \= ' || quote\_ident(v\_source\_prefix || '\_correct\_count') || ' \+ CASE WHEN $2 THEN 1 ELSE 0 END, ' ||  
      quote\_ident(v\_source\_prefix || '\_wrong\_count') || ' \= ' || quote\_ident(v\_source\_prefix || '\_wrong\_count') || ' \+ CASE WHEN $2 THEN 0 ELSE 1 END';  
  END IF;

  v\_sql := v\_sql || ', ' ||  
    'last\_event\_type \= $3, ' ||  
    'last\_event\_id \= COALESCE($4, last\_event\_id), ' ||  
    'source\_version \= COALESCE($5, source\_version), ' ||  
    'last\_recalculated\_at \= NOW(), ' ||  
    'updated\_at \= NOW() ' ||  
    'WHERE user\_id \= $1';

  EXECUTE v\_sql USING p\_user\_id, p\_is\_correct, p\_event\_type, p\_event\_id, p\_source\_version;

  UPDATE public.student\_kpi\_counters\_current  
  SET  
    overall\_score\_projection \= CASE  
      WHEN total\_answered\_count \> 0 THEN ROUND((total\_correct\_count::numeric \* 100\) / total\_answered\_count, 2\)  
      ELSE 0  
    END,  
    math\_score\_projection \= CASE  
      WHEN math\_answered\_count \> 0 THEN ROUND((math\_correct\_count::numeric \* 100\) / math\_answered\_count, 2\)  
      ELSE 0  
    END,  
    rw\_score\_projection \= CASE  
      WHEN rw\_answered\_count \> 0 THEN ROUND((rw\_correct\_count::numeric \* 100\) / rw\_answered\_count, 2\)  
      ELSE 0  
    END,  
    readiness\_metric \= CASE  
      WHEN total\_answered\_count \> 0 THEN ROUND((total\_correct\_count::numeric \* 100\) / total\_answered\_count, 2\)  
      ELSE 0  
    END,  
    confidence\_metric \= ROUND((LEAST(total\_answered\_count, 200)::numeric / 200\) \* 100, 2),  
    consistency\_metric \= COALESCE(consistency\_metric, ROUND((LEAST(total\_answered\_count, 60)::numeric / 60\) \* 100, 2)),  
    last\_recalculated\_at \= NOW(),  
    updated\_at \= NOW()  
  WHERE user\_id \= p\_user\_id  
  RETURNING \* INTO v\_row;

  RETURN v\_row;  
END;  
$function$  
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

| schemaname | tablename                    | policyname                                  | permissive | roles                | cmd    | qual                                                                                                                                                                                                            | with\_check                                                                                                                                                                                                      |  
| \---------- | \---------------------------- | \------------------------------------------- | \---------- | \-------------------- | \------ | \--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | \--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |  
| public     | answer\_attempts              | answer\_attempts\_admin\_select\_all            | PERMISSIVE | {authenticated}      | SELECT | is\_admin\_jwt()                                                                                                                                                                                                  | null                                                                                                                                                                                                            |  
| public     | answer\_attempts              | answer\_attempts\_admin\_update\_all            | PERMISSIVE | {authenticated}      | UPDATE | is\_admin\_jwt()                                                                                                                                                                                                  | is\_admin\_jwt()                                                                                                                                                                                                  |  
| public     | answer\_attempts              | answer\_attempts\_guardian\_select             | PERMISSIVE | {authenticated}      | SELECT | is\_guardian\_of(user\_id)                                                                                                                                                                                         | null                                                                                                                                                                                                            |  
| public     | answer\_attempts              | answer\_attempts\_insert\_own                  | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (auth.uid() \= user\_id)                                                                                                                                                                                          |  
| public     | answer\_attempts              | answer\_attempts\_select\_own                  | PERMISSIVE | {public}             | SELECT | (auth.uid() \= user\_id)                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | answer\_attempts              | answer\_attempts\_self\_insert                 | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | answer\_attempts              | answer\_attempts\_self\_select                 | PERMISSIVE | {authenticated}      | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | answer\_attempts              | answer\_attempts\_self\_update                 | PERMISSIVE | {authenticated}      | UPDATE | (user\_id \= auth.uid())                                                                                                                                                                                          | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | competency\_events            | competency\_events\_admin\_select\_all          | PERMISSIVE | {authenticated}      | SELECT | is\_admin\_jwt()                                                                                                                                                                                                  | null                                                                                                                                                                                                            |  
| public     | competency\_events            | competency\_events\_admin\_update\_all          | PERMISSIVE | {authenticated}      | UPDATE | is\_admin\_jwt()                                                                                                                                                                                                  | is\_admin\_jwt()                                                                                                                                                                                                  |  
| public     | competency\_events            | competency\_events\_guardian\_select           | PERMISSIVE | {authenticated}      | SELECT | is\_guardian\_of(user\_id)                                                                                                                                                                                         | null                                                                                                                                                                                                            |  
| public     | competency\_events            | competency\_events\_self\_insert               | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | competency\_events            | competency\_events\_self\_select               | PERMISSIVE | {authenticated}      | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | competency\_events            | competency\_events\_self\_update               | PERMISSIVE | {authenticated}      | UPDATE | (user\_id \= auth.uid())                                                                                                                                                                                          | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | full\_length\_exam\_questions   | flx\_questions\_delete                        | PERMISSIVE | {public}             | DELETE | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_questions   | flx\_questions\_insert                        | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) |  
| public     | full\_length\_exam\_questions   | flx\_questions\_select                        | PERMISSIVE | {public}             | SELECT | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_questions   | flx\_questions\_update                        | PERMISSIVE | {public}             | UPDATE | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) |  
| public     | full\_length\_exam\_questions   | questions\_delete\_own                        | PERMISSIVE | {public}             | DELETE | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_questions   | questions\_insert\_own                        | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) |  
| public     | full\_length\_exam\_questions   | questions\_select\_own                        | PERMISSIVE | {public}             | SELECT | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_questions   | questions\_update\_own                        | PERMISSIVE | {public}             | UPDATE | (EXISTS ( SELECT 1  
   FROM (full\_length\_exam\_modules m  
     JOIN full\_length\_exam\_sessions s ON ((s.id \= m.session\_id)))  
  WHERE ((m.id \= full\_length\_exam\_questions.module\_id) AND (s.user\_id \= auth.uid())))) | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_responses   | flx\_responses\_delete                        | PERMISSIVE | {public}             | DELETE | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_responses   | flx\_responses\_insert                        | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  |  
| public     | full\_length\_exam\_responses   | flx\_responses\_select                        | PERMISSIVE | {public}             | SELECT | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_responses   | flx\_responses\_update                        | PERMISSIVE | {public}             | UPDATE | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  |  
| public     | full\_length\_exam\_responses   | responses\_delete\_own                        | PERMISSIVE | {public}             | DELETE | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_responses   | responses\_insert\_own                        | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  |  
| public     | full\_length\_exam\_responses   | responses\_select\_own                        | PERMISSIVE | {public}             | SELECT | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_responses   | responses\_update\_own                        | PERMISSIVE | {public}             | UPDATE | (EXISTS ( SELECT 1  
   FROM full\_length\_exam\_sessions s  
  WHERE ((s.id \= full\_length\_exam\_responses.session\_id) AND (s.user\_id \= auth.uid()))))                                                                  | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_sessions    | flx\_sessions\_delete                         | PERMISSIVE | {public}             | DELETE | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_sessions    | flx\_sessions\_insert                         | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | full\_length\_exam\_sessions    | flx\_sessions\_select                         | PERMISSIVE | {public}             | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_sessions    | flx\_sessions\_update                         | PERMISSIVE | {public}             | UPDATE | (user\_id \= auth.uid())                                                                                                                                                                                          | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | full\_length\_exam\_sessions    | sessions\_delete\_own                         | PERMISSIVE | {public}             | DELETE | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_sessions    | sessions\_insert\_own                         | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | full\_length\_exam\_sessions    | sessions\_select\_own                         | PERMISSIVE | {public}             | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | full\_length\_exam\_sessions    | sessions\_update\_own                         | PERMISSIVE | {public}             | UPDATE | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | practice\_session\_items       | practice\_session\_items\_insert\_own           | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | practice\_session\_items       | practice\_session\_items\_select\_own           | PERMISSIVE | {authenticated}      | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | practice\_session\_items       | practice\_session\_items\_service              | PERMISSIVE | {authenticated}      | ALL    | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          |  
| public     | practice\_session\_items       | practice\_session\_items\_update\_own           | PERMISSIVE | {authenticated}      | UPDATE | (user\_id \= auth.uid())                                                                                                                                                                                          | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | practice\_sessions            | practice\_sessions\_admin\_select\_all          | PERMISSIVE | {authenticated}      | SELECT | is\_admin\_jwt()                                                                                                                                                                                                  | null                                                                                                                                                                                                            |  
| public     | practice\_sessions            | practice\_sessions\_admin\_update\_all          | PERMISSIVE | {authenticated}      | UPDATE | is\_admin\_jwt()                                                                                                                                                                                                  | is\_admin\_jwt()                                                                                                                                                                                                  |  
| public     | practice\_sessions            | practice\_sessions\_guardian\_select           | PERMISSIVE | {authenticated}      | SELECT | is\_guardian\_of(user\_id)                                                                                                                                                                                         | null                                                                                                                                                                                                            |  
| public     | practice\_sessions            | practice\_sessions\_insert\_own                | PERMISSIVE | {public}             | INSERT | null                                                                                                                                                                                                            | (auth.uid() \= user\_id)                                                                                                                                                                                          |  
| public     | practice\_sessions            | practice\_sessions\_select\_own                | PERMISSIVE | {public}             | SELECT | (auth.uid() \= user\_id)                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | practice\_sessions            | practice\_sessions\_self\_insert               | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | practice\_sessions            | practice\_sessions\_self\_select               | PERMISSIVE | {authenticated}      | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | practice\_sessions            | practice\_sessions\_self\_update               | PERMISSIVE | {authenticated}      | UPDATE | (user\_id \= auth.uid())                                                                                                                                                                                          | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | practice\_sessions            | practice\_sessions\_update\_own                | PERMISSIVE | {public}             | UPDATE | (auth.uid() \= user\_id)                                                                                                                                                                                          | (auth.uid() \= user\_id)                                                                                                                                                                                          |  
| public     | questions                    | questions\_select\_accessible                 | PERMISSIVE | {anon,authenticated} | SELECT | true                                                                                                                                                                                                            | null                                                                                                                                                                                                            |  
| public     | questions                    | questions\_select\_authenticated              | PERMISSIVE | {authenticated}      | SELECT | true                                                                                                                                                                                                            | null                                                                                                                                                                                                            |  
| public     | review\_error\_attempts        | review\_error\_attempts\_insert\_own            | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (student\_id \= auth.uid())                                                                                                                                                                                       |  
| public     | review\_error\_attempts        | review\_error\_attempts\_select\_own            | PERMISSIVE | {authenticated}      | SELECT | (student\_id \= auth.uid())                                                                                                                                                                                       | null                                                                                                                                                                                                            |  
| public     | review\_session\_items         | review\_session\_items\_insert\_own             | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (student\_id \= auth.uid())                                                                                                                                                                                       |  
| public     | review\_session\_items         | review\_session\_items\_select\_own             | PERMISSIVE | {authenticated}      | SELECT | (student\_id \= auth.uid())                                                                                                                                                                                       | null                                                                                                                                                                                                            |  
| public     | review\_session\_items         | review\_session\_items\_update\_own             | PERMISSIVE | {authenticated}      | UPDATE | (student\_id \= auth.uid())                                                                                                                                                                                       | (student\_id \= auth.uid())                                                                                                                                                                                       |  
| public     | review\_sessions              | review\_sessions\_insert\_own                  | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (student\_id \= auth.uid())                                                                                                                                                                                       |  
| public     | review\_sessions              | review\_sessions\_select\_own                  | PERMISSIVE | {authenticated}      | SELECT | (student\_id \= auth.uid())                                                                                                                                                                                       | null                                                                                                                                                                                                            |  
| public     | review\_sessions              | review\_sessions\_update\_own                  | PERMISSIVE | {authenticated}      | UPDATE | (student\_id \= auth.uid())                                                                                                                                                                                       | (student\_id \= auth.uid())                                                                                                                                                                                       |  
| public     | student\_domain\_mastery       | student\_domain\_mastery\_guardian\_select      | PERMISSIVE | {authenticated}      | SELECT | is\_guardian\_of(student\_id)                                                                                                                                                                                      | null                                                                                                                                                                                                            |  
| public     | student\_domain\_mastery       | student\_domain\_mastery\_self\_select          | PERMISSIVE | {authenticated}      | SELECT | (student\_id \= auth.uid())                                                                                                                                                                                       | null                                                                                                                                                                                                            |  
| public     | student\_domain\_mastery       | student\_domain\_mastery\_service\_all          | PERMISSIVE | {public}             | ALL    | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          |  
| public     | student\_kpi\_counters\_current | student\_kpi\_counters\_current\_select\_own     | PERMISSIVE | {authenticated}      | SELECT | (auth.uid() \= user\_id)                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | student\_kpi\_counters\_current | student\_kpi\_counters\_current\_service\_all    | PERMISSIVE | {public}             | ALL    | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          |  
| public     | student\_kpi\_rollups\_current  | student\_kpi\_rollups\_current\_service\_all     | PERMISSIVE | {public}             | ALL    | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          |  
| public     | student\_kpi\_snapshots        | student\_kpi\_snapshots\_select\_own            | PERMISSIVE | {authenticated}      | SELECT | (auth.uid() \= user\_id)                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | student\_kpi\_snapshots        | student\_kpi\_snapshots\_service\_all           | PERMISSIVE | {public}             | ALL    | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          |  
| public     | student\_question\_attempts    | student\_question\_attempts\_admin\_select\_all  | PERMISSIVE | {authenticated}      | SELECT | is\_admin\_jwt()                                                                                                                                                                                                  | null                                                                                                                                                                                                            |  
| public     | student\_question\_attempts    | student\_question\_attempts\_admin\_update\_all  | PERMISSIVE | {authenticated}      | UPDATE | is\_admin\_jwt()                                                                                                                                                                                                  | is\_admin\_jwt()                                                                                                                                                                                                  |  
| public     | student\_question\_attempts    | student\_question\_attempts\_guardian\_select   | PERMISSIVE | {authenticated}      | SELECT | is\_guardian\_of(user\_id)                                                                                                                                                                                         | null                                                                                                                                                                                                            |  
| public     | student\_question\_attempts    | student\_question\_attempts\_self\_insert       | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                                                                                                                            | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | student\_question\_attempts    | student\_question\_attempts\_self\_select       | PERMISSIVE | {authenticated}      | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | student\_question\_attempts    | student\_question\_attempts\_self\_update       | PERMISSIVE | {authenticated}      | UPDATE | (user\_id \= auth.uid())                                                                                                                                                                                          | (user\_id \= auth.uid())                                                                                                                                                                                          |  
| public     | student\_section\_projections  | student\_section\_projections\_guardian\_select | PERMISSIVE | {authenticated}      | SELECT | is\_guardian\_of(student\_id)                                                                                                                                                                                      | null                                                                                                                                                                                                            |  
| public     | student\_section\_projections  | student\_section\_projections\_self\_select     | PERMISSIVE | {authenticated}      | SELECT | (student\_id \= auth.uid())                                                                                                                                                                                       | null                                                                                                                                                                                                            |  
| public     | student\_section\_projections  | student\_section\_projections\_service\_all     | PERMISSIVE | {public}             | ALL    | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          | ((auth.jwt() \-\>\> 'role'::text) \= 'service\_role'::text)                                                                                                                                                          |  
| public     | student\_skill\_mastery        | skill\_mastery\_no\_direct\_write               | PERMISSIVE | {authenticated}      | ALL    | false                                                                                                                                                                                                           | false                                                                                                                                                                                                           |  
| public     | student\_skill\_mastery        | student\_skill\_mastery\_admin\_select\_all      | PERMISSIVE | {authenticated}      | SELECT | is\_admin\_jwt()                                                                                                                                                                                                  | null                                                                                                                                                                                                            |  
| public     | student\_skill\_mastery        | student\_skill\_mastery\_guardian\_select       | PERMISSIVE | {authenticated}      | SELECT | is\_guardian\_of(user\_id)                                                                                                                                                                                         | null                                                                                                                                                                                                            |  
| public     | student\_skill\_mastery        | student\_skill\_mastery\_self\_select           | PERMISSIVE | {authenticated}      | SELECT | (user\_id \= auth.uid())                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | user\_competencies            | uc\_select\_own                               | PERMISSIVE | {public}             | SELECT | (auth.uid() \= user\_id)                                                                                                                                                                                          | null                                                                                                                                                                                                            |  
| public     | user\_competencies            | user\_competencies\_guardian\_read             | PERMISSIVE | {public}             | SELECT | (EXISTS ( SELECT 1  
   FROM guardian\_links gl  
  WHERE ((gl.student\_user\_id \= user\_competencies.user\_id) AND (gl.guardian\_profile\_id \= auth.uid()) AND (gl.status \= 'active'::text))))                            | null                                                                                                                                                                                                            |  
| public     | user\_competencies            | user\_competencies\_read\_own                  | PERMISSIVE | {public}             | SELECT | (auth.uid() \= user\_id)                                                                                                                                                                                          | null                                                                                                                                                                                                            |

| table\_schema | table\_name                   | grantee       | privilege\_type | is\_grantable |  
| \------------ | \---------------------------- | \------------- | \-------------- | \------------ |  
| public       | answer\_attempts              | anon          | DELETE         | NO           |  
| public       | answer\_attempts              | anon          | INSERT         | NO           |  
| public       | answer\_attempts              | anon          | REFERENCES     | NO           |  
| public       | answer\_attempts              | anon          | SELECT         | NO           |  
| public       | answer\_attempts              | anon          | TRIGGER        | NO           |  
| public       | answer\_attempts              | anon          | TRUNCATE       | NO           |  
| public       | answer\_attempts              | anon          | UPDATE         | NO           |  
| public       | answer\_attempts              | authenticated | DELETE         | NO           |  
| public       | answer\_attempts              | authenticated | INSERT         | NO           |  
| public       | answer\_attempts              | authenticated | REFERENCES     | NO           |  
| public       | answer\_attempts              | authenticated | SELECT         | NO           |  
| public       | answer\_attempts              | authenticated | TRIGGER        | NO           |  
| public       | answer\_attempts              | authenticated | TRUNCATE       | NO           |  
| public       | answer\_attempts              | authenticated | UPDATE         | NO           |  
| public       | answer\_attempts              | postgres      | DELETE         | YES          |  
| public       | answer\_attempts              | postgres      | INSERT         | YES          |  
| public       | answer\_attempts              | postgres      | REFERENCES     | YES          |  
| public       | answer\_attempts              | postgres      | SELECT         | YES          |  
| public       | answer\_attempts              | postgres      | TRIGGER        | YES          |  
| public       | answer\_attempts              | postgres      | TRUNCATE       | YES          |  
| public       | answer\_attempts              | postgres      | UPDATE         | YES          |  
| public       | answer\_attempts              | service\_role  | DELETE         | NO           |  
| public       | answer\_attempts              | service\_role  | INSERT         | NO           |  
| public       | answer\_attempts              | service\_role  | REFERENCES     | NO           |  
| public       | answer\_attempts              | service\_role  | SELECT         | NO           |  
| public       | answer\_attempts              | service\_role  | TRIGGER        | NO           |  
| public       | answer\_attempts              | service\_role  | TRUNCATE       | NO           |  
| public       | answer\_attempts              | service\_role  | UPDATE         | NO           |  
| public       | competency\_events            | anon          | DELETE         | NO           |  
| public       | competency\_events            | anon          | INSERT         | NO           |  
| public       | competency\_events            | anon          | REFERENCES     | NO           |  
| public       | competency\_events            | anon          | SELECT         | NO           |  
| public       | competency\_events            | anon          | TRIGGER        | NO           |  
| public       | competency\_events            | anon          | TRUNCATE       | NO           |  
| public       | competency\_events            | anon          | UPDATE         | NO           |  
| public       | competency\_events            | authenticated | DELETE         | NO           |  
| public       | competency\_events            | authenticated | INSERT         | NO           |  
| public       | competency\_events            | authenticated | REFERENCES     | NO           |  
| public       | competency\_events            | authenticated | SELECT         | NO           |  
| public       | competency\_events            | authenticated | TRIGGER        | NO           |  
| public       | competency\_events            | authenticated | TRUNCATE       | NO           |  
| public       | competency\_events            | authenticated | UPDATE         | NO           |  
| public       | competency\_events            | postgres      | DELETE         | YES          |  
| public       | competency\_events            | postgres      | INSERT         | YES          |  
| public       | competency\_events            | postgres      | REFERENCES     | YES          |  
| public       | competency\_events            | postgres      | SELECT         | YES          |  
| public       | competency\_events            | postgres      | TRIGGER        | YES          |  
| public       | competency\_events            | postgres      | TRUNCATE       | YES          |  
| public       | competency\_events            | postgres      | UPDATE         | YES          |  
| public       | competency\_events            | service\_role  | DELETE         | NO           |  
| public       | competency\_events            | service\_role  | INSERT         | NO           |  
| public       | competency\_events            | service\_role  | REFERENCES     | NO           |  
| public       | competency\_events            | service\_role  | SELECT         | NO           |  
| public       | competency\_events            | service\_role  | TRIGGER        | NO           |  
| public       | competency\_events            | service\_role  | TRUNCATE       | NO           |  
| public       | competency\_events            | service\_role  | UPDATE         | NO           |  
| public       | full\_length\_exam\_questions   | anon          | DELETE         | NO           |  
| public       | full\_length\_exam\_questions   | anon          | INSERT         | NO           |  
| public       | full\_length\_exam\_questions   | anon          | REFERENCES     | NO           |  
| public       | full\_length\_exam\_questions   | anon          | SELECT         | NO           |  
| public       | full\_length\_exam\_questions   | anon          | TRIGGER        | NO           |  
| public       | full\_length\_exam\_questions   | anon          | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_questions   | anon          | UPDATE         | NO           |  
| public       | full\_length\_exam\_questions   | authenticated | DELETE         | NO           |  
| public       | full\_length\_exam\_questions   | authenticated | INSERT         | NO           |  
| public       | full\_length\_exam\_questions   | authenticated | REFERENCES     | NO           |  
| public       | full\_length\_exam\_questions   | authenticated | SELECT         | NO           |  
| public       | full\_length\_exam\_questions   | authenticated | TRIGGER        | NO           |  
| public       | full\_length\_exam\_questions   | authenticated | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_questions   | authenticated | UPDATE         | NO           |  
| public       | full\_length\_exam\_questions   | postgres      | DELETE         | YES          |  
| public       | full\_length\_exam\_questions   | postgres      | INSERT         | YES          |  
| public       | full\_length\_exam\_questions   | postgres      | REFERENCES     | YES          |  
| public       | full\_length\_exam\_questions   | postgres      | SELECT         | YES          |  
| public       | full\_length\_exam\_questions   | postgres      | TRIGGER        | YES          |  
| public       | full\_length\_exam\_questions   | postgres      | TRUNCATE       | YES          |  
| public       | full\_length\_exam\_questions   | postgres      | UPDATE         | YES          |  
| public       | full\_length\_exam\_questions   | service\_role  | DELETE         | NO           |  
| public       | full\_length\_exam\_questions   | service\_role  | INSERT         | NO           |  
| public       | full\_length\_exam\_questions   | service\_role  | REFERENCES     | NO           |  
| public       | full\_length\_exam\_questions   | service\_role  | SELECT         | NO           |  
| public       | full\_length\_exam\_questions   | service\_role  | TRIGGER        | NO           |  
| public       | full\_length\_exam\_questions   | service\_role  | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_questions   | service\_role  | UPDATE         | NO           |  
| public       | full\_length\_exam\_responses   | anon          | DELETE         | NO           |  
| public       | full\_length\_exam\_responses   | anon          | INSERT         | NO           |  
| public       | full\_length\_exam\_responses   | anon          | REFERENCES     | NO           |  
| public       | full\_length\_exam\_responses   | anon          | SELECT         | NO           |  
| public       | full\_length\_exam\_responses   | anon          | TRIGGER        | NO           |  
| public       | full\_length\_exam\_responses   | anon          | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_responses   | anon          | UPDATE         | NO           |  
| public       | full\_length\_exam\_responses   | authenticated | DELETE         | NO           |  
| public       | full\_length\_exam\_responses   | authenticated | INSERT         | NO           |  
| public       | full\_length\_exam\_responses   | authenticated | REFERENCES     | NO           |  
| public       | full\_length\_exam\_responses   | authenticated | SELECT         | NO           |  
| public       | full\_length\_exam\_responses   | authenticated | TRIGGER        | NO           |  
| public       | full\_length\_exam\_responses   | authenticated | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_responses   | authenticated | UPDATE         | NO           |  
| public       | full\_length\_exam\_responses   | postgres      | DELETE         | YES          |  
| public       | full\_length\_exam\_responses   | postgres      | INSERT         | YES          |  
| public       | full\_length\_exam\_responses   | postgres      | REFERENCES     | YES          |  
| public       | full\_length\_exam\_responses   | postgres      | SELECT         | YES          |  
| public       | full\_length\_exam\_responses   | postgres      | TRIGGER        | YES          |  
| public       | full\_length\_exam\_responses   | postgres      | TRUNCATE       | YES          |  
| public       | full\_length\_exam\_responses   | postgres      | UPDATE         | YES          |  
| public       | full\_length\_exam\_responses   | service\_role  | DELETE         | NO           |  
| public       | full\_length\_exam\_responses   | service\_role  | INSERT         | NO           |  
| public       | full\_length\_exam\_responses   | service\_role  | REFERENCES     | NO           |  
| public       | full\_length\_exam\_responses   | service\_role  | SELECT         | NO           |  
| public       | full\_length\_exam\_responses   | service\_role  | TRIGGER        | NO           |  
| public       | full\_length\_exam\_responses   | service\_role  | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_responses   | service\_role  | UPDATE         | NO           |  
| public       | full\_length\_exam\_sessions    | anon          | DELETE         | NO           |  
| public       | full\_length\_exam\_sessions    | anon          | INSERT         | NO           |  
| public       | full\_length\_exam\_sessions    | anon          | REFERENCES     | NO           |  
| public       | full\_length\_exam\_sessions    | anon          | SELECT         | NO           |  
| public       | full\_length\_exam\_sessions    | anon          | TRIGGER        | NO           |  
| public       | full\_length\_exam\_sessions    | anon          | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_sessions    | anon          | UPDATE         | NO           |  
| public       | full\_length\_exam\_sessions    | authenticated | DELETE         | NO           |  
| public       | full\_length\_exam\_sessions    | authenticated | INSERT         | NO           |  
| public       | full\_length\_exam\_sessions    | authenticated | REFERENCES     | NO           |  
| public       | full\_length\_exam\_sessions    | authenticated | SELECT         | NO           |  
| public       | full\_length\_exam\_sessions    | authenticated | TRIGGER        | NO           |  
| public       | full\_length\_exam\_sessions    | authenticated | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_sessions    | authenticated | UPDATE         | NO           |  
| public       | full\_length\_exam\_sessions    | postgres      | DELETE         | YES          |  
| public       | full\_length\_exam\_sessions    | postgres      | INSERT         | YES          |  
| public       | full\_length\_exam\_sessions    | postgres      | REFERENCES     | YES          |  
| public       | full\_length\_exam\_sessions    | postgres      | SELECT         | YES          |  
| public       | full\_length\_exam\_sessions    | postgres      | TRIGGER        | YES          |  
| public       | full\_length\_exam\_sessions    | postgres      | TRUNCATE       | YES          |  
| public       | full\_length\_exam\_sessions    | postgres      | UPDATE         | YES          |  
| public       | full\_length\_exam\_sessions    | service\_role  | DELETE         | NO           |  
| public       | full\_length\_exam\_sessions    | service\_role  | INSERT         | NO           |  
| public       | full\_length\_exam\_sessions    | service\_role  | REFERENCES     | NO           |  
| public       | full\_length\_exam\_sessions    | service\_role  | SELECT         | NO           |  
| public       | full\_length\_exam\_sessions    | service\_role  | TRIGGER        | NO           |  
| public       | full\_length\_exam\_sessions    | service\_role  | TRUNCATE       | NO           |  
| public       | full\_length\_exam\_sessions    | service\_role  | UPDATE         | NO           |  
| public       | practice\_session\_items       | anon          | DELETE         | NO           |  
| public       | practice\_session\_items       | anon          | INSERT         | NO           |  
| public       | practice\_session\_items       | anon          | REFERENCES     | NO           |  
| public       | practice\_session\_items       | anon          | SELECT         | NO           |  
| public       | practice\_session\_items       | anon          | TRIGGER        | NO           |  
| public       | practice\_session\_items       | anon          | TRUNCATE       | NO           |  
| public       | practice\_session\_items       | anon          | UPDATE         | NO           |  
| public       | practice\_session\_items       | authenticated | DELETE         | NO           |  
| public       | practice\_session\_items       | authenticated | INSERT         | NO           |  
| public       | practice\_session\_items       | authenticated | REFERENCES     | NO           |  
| public       | practice\_session\_items       | authenticated | SELECT         | NO           |  
| public       | practice\_session\_items       | authenticated | TRIGGER        | NO           |  
| public       | practice\_session\_items       | authenticated | TRUNCATE       | NO           |  
| public       | practice\_session\_items       | authenticated | UPDATE         | NO           |  
| public       | practice\_session\_items       | postgres      | DELETE         | YES          |  
| public       | practice\_session\_items       | postgres      | INSERT         | YES          |  
| public       | practice\_session\_items       | postgres      | REFERENCES     | YES          |  
| public       | practice\_session\_items       | postgres      | SELECT         | YES          |  
| public       | practice\_session\_items       | postgres      | TRIGGER        | YES          |  
| public       | practice\_session\_items       | postgres      | TRUNCATE       | YES          |  
| public       | practice\_session\_items       | postgres      | UPDATE         | YES          |  
| public       | practice\_session\_items       | service\_role  | DELETE         | NO           |  
| public       | practice\_session\_items       | service\_role  | INSERT         | NO           |  
| public       | practice\_session\_items       | service\_role  | REFERENCES     | NO           |  
| public       | practice\_session\_items       | service\_role  | SELECT         | NO           |  
| public       | practice\_session\_items       | service\_role  | TRIGGER        | NO           |  
| public       | practice\_session\_items       | service\_role  | TRUNCATE       | NO           |  
| public       | practice\_session\_items       | service\_role  | UPDATE         | NO           |  
| public       | practice\_sessions            | anon          | DELETE         | NO           |  
| public       | practice\_sessions            | anon          | INSERT         | NO           |  
| public       | practice\_sessions            | anon          | REFERENCES     | NO           |  
| public       | practice\_sessions            | anon          | SELECT         | NO           |  
| public       | practice\_sessions            | anon          | TRIGGER        | NO           |  
| public       | practice\_sessions            | anon          | TRUNCATE       | NO           |  
| public       | practice\_sessions            | anon          | UPDATE         | NO           |  
| public       | practice\_sessions            | authenticated | DELETE         | NO           |  
| public       | practice\_sessions            | authenticated | INSERT         | NO           |  
| public       | practice\_sessions            | authenticated | REFERENCES     | NO           |  
| public       | practice\_sessions            | authenticated | SELECT         | NO           |  
| public       | practice\_sessions            | authenticated | TRIGGER        | NO           |  
| public       | practice\_sessions            | authenticated | TRUNCATE       | NO           |  
| public       | practice\_sessions            | authenticated | UPDATE         | NO           |  
| public       | practice\_sessions            | postgres      | DELETE         | YES          |  
| public       | practice\_sessions            | postgres      | INSERT         | YES          |  
| public       | practice\_sessions            | postgres      | REFERENCES     | YES          |  
| public       | practice\_sessions            | postgres      | SELECT         | YES          |  
| public       | practice\_sessions            | postgres      | TRIGGER        | YES          |  
| public       | practice\_sessions            | postgres      | TRUNCATE       | YES          |  
| public       | practice\_sessions            | postgres      | UPDATE         | YES          |  
| public       | practice\_sessions            | service\_role  | DELETE         | NO           |  
| public       | practice\_sessions            | service\_role  | INSERT         | NO           |  
| public       | practice\_sessions            | service\_role  | REFERENCES     | NO           |  
| public       | practice\_sessions            | service\_role  | SELECT         | NO           |  
| public       | practice\_sessions            | service\_role  | TRIGGER        | NO           |  
| public       | practice\_sessions            | service\_role  | TRUNCATE       | NO           |  
| public       | practice\_sessions            | service\_role  | UPDATE         | NO           |  
| public       | questions                    | anon          | DELETE         | NO           |  
| public       | questions                    | anon          | INSERT         | NO           |  
| public       | questions                    | anon          | REFERENCES     | NO           |  
| public       | questions                    | anon          | SELECT         | NO           |  
| public       | questions                    | anon          | TRIGGER        | NO           |  
| public       | questions                    | anon          | TRUNCATE       | NO           |  
| public       | questions                    | anon          | UPDATE         | NO           |  
| public       | questions                    | authenticated | DELETE         | NO           |  
| public       | questions                    | authenticated | INSERT         | NO           |  
| public       | questions                    | authenticated | REFERENCES     | NO           |  
| public       | questions                    | authenticated | SELECT         | NO           |  
| public       | questions                    | authenticated | TRIGGER        | NO           |  
| public       | questions                    | authenticated | TRUNCATE       | NO           |  
| public       | questions                    | authenticated | UPDATE         | NO           |  
| public       | questions                    | postgres      | DELETE         | YES          |  
| public       | questions                    | postgres      | INSERT         | YES          |  
| public       | questions                    | postgres      | REFERENCES     | YES          |  
| public       | questions                    | postgres      | SELECT         | YES          |  
| public       | questions                    | postgres      | TRIGGER        | YES          |  
| public       | questions                    | postgres      | TRUNCATE       | YES          |  
| public       | questions                    | postgres      | UPDATE         | YES          |  
| public       | questions                    | service\_role  | DELETE         | NO           |  
| public       | questions                    | service\_role  | INSERT         | NO           |  
| public       | questions                    | service\_role  | REFERENCES     | NO           |  
| public       | questions                    | service\_role  | SELECT         | NO           |  
| public       | questions                    | service\_role  | TRIGGER        | NO           |  
| public       | questions                    | service\_role  | TRUNCATE       | NO           |  
| public       | questions                    | service\_role  | UPDATE         | NO           |  
| public       | review\_error\_attempts        | anon          | DELETE         | NO           |  
| public       | review\_error\_attempts        | anon          | INSERT         | NO           |  
| public       | review\_error\_attempts        | anon          | REFERENCES     | NO           |  
| public       | review\_error\_attempts        | anon          | SELECT         | NO           |  
| public       | review\_error\_attempts        | anon          | TRIGGER        | NO           |  
| public       | review\_error\_attempts        | anon          | TRUNCATE       | NO           |  
| public       | review\_error\_attempts        | anon          | UPDATE         | NO           |  
| public       | review\_error\_attempts        | authenticated | DELETE         | NO           |  
| public       | review\_error\_attempts        | authenticated | INSERT         | NO           |  
| public       | review\_error\_attempts        | authenticated | REFERENCES     | NO           |  
| public       | review\_error\_attempts        | authenticated | SELECT         | NO           |  
| public       | review\_error\_attempts        | authenticated | TRIGGER        | NO           |  
| public       | review\_error\_attempts        | authenticated | TRUNCATE       | NO           |  
| public       | review\_error\_attempts        | authenticated | UPDATE         | NO           |  
| public       | review\_error\_attempts        | postgres      | DELETE         | YES          |  
| public       | review\_error\_attempts        | postgres      | INSERT         | YES          |  
| public       | review\_error\_attempts        | postgres      | REFERENCES     | YES          |  
| public       | review\_error\_attempts        | postgres      | SELECT         | YES          |  
| public       | review\_error\_attempts        | postgres      | TRIGGER        | YES          |  
| public       | review\_error\_attempts        | postgres      | TRUNCATE       | YES          |  
| public       | review\_error\_attempts        | postgres      | UPDATE         | YES          |  
| public       | review\_error\_attempts        | service\_role  | DELETE         | NO           |  
| public       | review\_error\_attempts        | service\_role  | INSERT         | NO           |  
| public       | review\_error\_attempts        | service\_role  | REFERENCES     | NO           |  
| public       | review\_error\_attempts        | service\_role  | SELECT         | NO           |  
| public       | review\_error\_attempts        | service\_role  | TRIGGER        | NO           |  
| public       | review\_error\_attempts        | service\_role  | TRUNCATE       | NO           |  
| public       | review\_error\_attempts        | service\_role  | UPDATE         | NO           |  
| public       | review\_session\_items         | anon          | DELETE         | NO           |  
| public       | review\_session\_items         | anon          | INSERT         | NO           |  
| public       | review\_session\_items         | anon          | REFERENCES     | NO           |  
| public       | review\_session\_items         | anon          | SELECT         | NO           |  
| public       | review\_session\_items         | anon          | TRIGGER        | NO           |  
| public       | review\_session\_items         | anon          | TRUNCATE       | NO           |  
| public       | review\_session\_items         | anon          | UPDATE         | NO           |  
| public       | review\_session\_items         | authenticated | DELETE         | NO           |  
| public       | review\_session\_items         | authenticated | INSERT         | NO           |  
| public       | review\_session\_items         | authenticated | REFERENCES     | NO           |  
| public       | review\_session\_items         | authenticated | SELECT         | NO           |  
| public       | review\_session\_items         | authenticated | TRIGGER        | NO           |  
| public       | review\_session\_items         | authenticated | TRUNCATE       | NO           |  
| public       | review\_session\_items         | authenticated | UPDATE         | NO           |  
| public       | review\_session\_items         | postgres      | DELETE         | YES          |  
| public       | review\_session\_items         | postgres      | INSERT         | YES          |  
| public       | review\_session\_items         | postgres      | REFERENCES     | YES          |  
| public       | review\_session\_items         | postgres      | SELECT         | YES          |  
| public       | review\_session\_items         | postgres      | TRIGGER        | YES          |  
| public       | review\_session\_items         | postgres      | TRUNCATE       | YES          |  
| public       | review\_session\_items         | postgres      | UPDATE         | YES          |  
| public       | review\_session\_items         | service\_role  | DELETE         | NO           |  
| public       | review\_session\_items         | service\_role  | INSERT         | NO           |  
| public       | review\_session\_items         | service\_role  | REFERENCES     | NO           |  
| public       | review\_session\_items         | service\_role  | SELECT         | NO           |  
| public       | review\_session\_items         | service\_role  | TRIGGER        | NO           |  
| public       | review\_session\_items         | service\_role  | TRUNCATE       | NO           |  
| public       | review\_session\_items         | service\_role  | UPDATE         | NO           |  
| public       | review\_sessions              | anon          | DELETE         | NO           |  
| public       | review\_sessions              | anon          | INSERT         | NO           |  
| public       | review\_sessions              | anon          | REFERENCES     | NO           |  
| public       | review\_sessions              | anon          | SELECT         | NO           |  
| public       | review\_sessions              | anon          | TRIGGER        | NO           |  
| public       | review\_sessions              | anon          | TRUNCATE       | NO           |  
| public       | review\_sessions              | anon          | UPDATE         | NO           |  
| public       | review\_sessions              | authenticated | DELETE         | NO           |  
| public       | review\_sessions              | authenticated | INSERT         | NO           |  
| public       | review\_sessions              | authenticated | REFERENCES     | NO           |  
| public       | review\_sessions              | authenticated | SELECT         | NO           |  
| public       | review\_sessions              | authenticated | TRIGGER        | NO           |  
| public       | review\_sessions              | authenticated | TRUNCATE       | NO           |  
| public       | review\_sessions              | authenticated | UPDATE         | NO           |  
| public       | review\_sessions              | postgres      | DELETE         | YES          |  
| public       | review\_sessions              | postgres      | INSERT         | YES          |  
| public       | review\_sessions              | postgres      | REFERENCES     | YES          |  
| public       | review\_sessions              | postgres      | SELECT         | YES          |  
| public       | review\_sessions              | postgres      | TRIGGER        | YES          |  
| public       | review\_sessions              | postgres      | TRUNCATE       | YES          |  
| public       | review\_sessions              | postgres      | UPDATE         | YES          |  
| public       | review\_sessions              | service\_role  | DELETE         | NO           |  
| public       | review\_sessions              | service\_role  | INSERT         | NO           |  
| public       | review\_sessions              | service\_role  | REFERENCES     | NO           |  
| public       | review\_sessions              | service\_role  | SELECT         | NO           |  
| public       | review\_sessions              | service\_role  | TRIGGER        | NO           |  
| public       | review\_sessions              | service\_role  | TRUNCATE       | NO           |  
| public       | review\_sessions              | service\_role  | UPDATE         | NO           |  
| public       | student\_domain\_mastery       | anon          | DELETE         | NO           |  
| public       | student\_domain\_mastery       | anon          | INSERT         | NO           |  
| public       | student\_domain\_mastery       | anon          | REFERENCES     | NO           |  
| public       | student\_domain\_mastery       | anon          | SELECT         | NO           |  
| public       | student\_domain\_mastery       | anon          | TRIGGER        | NO           |  
| public       | student\_domain\_mastery       | anon          | TRUNCATE       | NO           |  
| public       | student\_domain\_mastery       | anon          | UPDATE         | NO           |  
| public       | student\_domain\_mastery       | authenticated | DELETE         | NO           |  
| public       | student\_domain\_mastery       | authenticated | INSERT         | NO           |  
| public       | student\_domain\_mastery       | authenticated | REFERENCES     | NO           |  
| public       | student\_domain\_mastery       | authenticated | SELECT         | NO           |  
| public       | student\_domain\_mastery       | authenticated | TRIGGER        | NO           |  
| public       | student\_domain\_mastery       | authenticated | TRUNCATE       | NO           |  
| public       | student\_domain\_mastery       | authenticated | UPDATE         | NO           |  
| public       | student\_domain\_mastery       | postgres      | DELETE         | YES          |  
| public       | student\_domain\_mastery       | postgres      | INSERT         | YES          |  
| public       | student\_domain\_mastery       | postgres      | REFERENCES     | YES          |  
| public       | student\_domain\_mastery       | postgres      | SELECT         | YES          |  
| public       | student\_domain\_mastery       | postgres      | TRIGGER        | YES          |  
| public       | student\_domain\_mastery       | postgres      | TRUNCATE       | YES          |  
| public       | student\_domain\_mastery       | postgres      | UPDATE         | YES          |  
| public       | student\_domain\_mastery       | service\_role  | DELETE         | NO           |  
| public       | student\_domain\_mastery       | service\_role  | INSERT         | NO           |  
| public       | student\_domain\_mastery       | service\_role  | REFERENCES     | NO           |  
| public       | student\_domain\_mastery       | service\_role  | SELECT         | NO           |  
| public       | student\_domain\_mastery       | service\_role  | TRIGGER        | NO           |  
| public       | student\_domain\_mastery       | service\_role  | TRUNCATE       | NO           |  
| public       | student\_domain\_mastery       | service\_role  | UPDATE         | NO           |  
| public       | student\_kpi\_counters\_current | anon          | DELETE         | NO           |  
| public       | student\_kpi\_counters\_current | anon          | INSERT         | NO           |  
| public       | student\_kpi\_counters\_current | anon          | REFERENCES     | NO           |  
| public       | student\_kpi\_counters\_current | anon          | SELECT         | NO           |  
| public       | student\_kpi\_counters\_current | anon          | TRIGGER        | NO           |  
| public       | student\_kpi\_counters\_current | anon          | TRUNCATE       | NO           |  
| public       | student\_kpi\_counters\_current | anon          | UPDATE         | NO           |  
| public       | student\_kpi\_counters\_current | authenticated | DELETE         | NO           |  
| public       | student\_kpi\_counters\_current | authenticated | INSERT         | NO           |  
| public       | student\_kpi\_counters\_current | authenticated | REFERENCES     | NO           |  
| public       | student\_kpi\_counters\_current | authenticated | SELECT         | NO           |  
| public       | student\_kpi\_counters\_current | authenticated | TRIGGER        | NO           |  
| public       | student\_kpi\_counters\_current | authenticated | TRUNCATE       | NO           |  
| public       | student\_kpi\_counters\_current | authenticated | UPDATE         | NO           |  
| public       | student\_kpi\_counters\_current | postgres      | DELETE         | YES          |  
| public       | student\_kpi\_counters\_current | postgres      | INSERT         | YES          |  
| public       | student\_kpi\_counters\_current | postgres      | REFERENCES     | YES          |  
| public       | student\_kpi\_counters\_current | postgres      | SELECT         | YES          |  
| public       | student\_kpi\_counters\_current | postgres      | TRIGGER        | YES          |  
| public       | student\_kpi\_counters\_current | postgres      | TRUNCATE       | YES          |  
| public       | student\_kpi\_counters\_current | postgres      | UPDATE         | YES          |  
| public       | student\_kpi\_counters\_current | service\_role  | DELETE         | NO           |  
| public       | student\_kpi\_counters\_current | service\_role  | INSERT         | NO           |  
| public       | student\_kpi\_counters\_current | service\_role  | REFERENCES     | NO           |  
| public       | student\_kpi\_counters\_current | service\_role  | SELECT         | NO           |  
| public       | student\_kpi\_counters\_current | service\_role  | TRIGGER        | NO           |  
| public       | student\_kpi\_counters\_current | service\_role  | TRUNCATE       | NO           |  
| public       | student\_kpi\_counters\_current | service\_role  | UPDATE         | NO           |  
| public       | student\_kpi\_rollups\_current  | anon          | DELETE         | NO           |  
| public       | student\_kpi\_rollups\_current  | anon          | INSERT         | NO           |  
| public       | student\_kpi\_rollups\_current  | anon          | REFERENCES     | NO           |  
| public       | student\_kpi\_rollups\_current  | anon          | SELECT         | NO           |  
| public       | student\_kpi\_rollups\_current  | anon          | TRIGGER        | NO           |  
| public       | student\_kpi\_rollups\_current  | anon          | TRUNCATE       | NO           |  
| public       | student\_kpi\_rollups\_current  | anon          | UPDATE         | NO           |  
| public       | student\_kpi\_rollups\_current  | authenticated | DELETE         | NO           |  
| public       | student\_kpi\_rollups\_current  | authenticated | INSERT         | NO           |  
| public       | student\_kpi\_rollups\_current  | authenticated | REFERENCES     | NO           |  
| public       | student\_kpi\_rollups\_current  | authenticated | SELECT         | NO           |  
| public       | student\_kpi\_rollups\_current  | authenticated | TRIGGER        | NO           |  
| public       | student\_kpi\_rollups\_current  | authenticated | TRUNCATE       | NO           |  
| public       | student\_kpi\_rollups\_current  | authenticated | UPDATE         | NO           |  
| public       | student\_kpi\_rollups\_current  | postgres      | DELETE         | YES          |  
| public       | student\_kpi\_rollups\_current  | postgres      | INSERT         | YES          |  
| public       | student\_kpi\_rollups\_current  | postgres      | REFERENCES     | YES          |  
| public       | student\_kpi\_rollups\_current  | postgres      | SELECT         | YES          |  
| public       | student\_kpi\_rollups\_current  | postgres      | TRIGGER        | YES          |  
| public       | student\_kpi\_rollups\_current  | postgres      | TRUNCATE       | YES          |  
| public       | student\_kpi\_rollups\_current  | postgres      | UPDATE         | YES          |  
| public       | student\_kpi\_rollups\_current  | service\_role  | DELETE         | NO           |  
| public       | student\_kpi\_rollups\_current  | service\_role  | INSERT         | NO           |  
| public       | student\_kpi\_rollups\_current  | service\_role  | REFERENCES     | NO           |  
| public       | student\_kpi\_rollups\_current  | service\_role  | SELECT         | NO           |  
| public       | student\_kpi\_rollups\_current  | service\_role  | TRIGGER        | NO           |  
| public       | student\_kpi\_rollups\_current  | service\_role  | TRUNCATE       | NO           |  
| public       | student\_kpi\_rollups\_current  | service\_role  | UPDATE         | NO           |  
| public       | student\_kpi\_snapshots        | anon          | DELETE         | NO           |  
| public       | student\_kpi\_snapshots        | anon          | INSERT         | NO           |  
| public       | student\_kpi\_snapshots        | anon          | REFERENCES     | NO           |  
| public       | student\_kpi\_snapshots        | anon          | SELECT         | NO           |  
| public       | student\_kpi\_snapshots        | anon          | TRIGGER        | NO           |  
| public       | student\_kpi\_snapshots        | anon          | TRUNCATE       | NO           |  
| public       | student\_kpi\_snapshots        | anon          | UPDATE         | NO           |  
| public       | student\_kpi\_snapshots        | authenticated | DELETE         | NO           |  
| public       | student\_kpi\_snapshots        | authenticated | INSERT         | NO           |  
| public       | student\_kpi\_snapshots        | authenticated | REFERENCES     | NO           |  
| public       | student\_kpi\_snapshots        | authenticated | SELECT         | NO           |  
| public       | student\_kpi\_snapshots        | authenticated | TRIGGER        | NO           |  
| public       | student\_kpi\_snapshots        | authenticated | TRUNCATE       | NO           |  
| public       | student\_kpi\_snapshots        | authenticated | UPDATE         | NO           |  
| public       | student\_kpi\_snapshots        | postgres      | DELETE         | YES          |  
| public       | student\_kpi\_snapshots        | postgres      | INSERT         | YES          |  
| public       | student\_kpi\_snapshots        | postgres      | REFERENCES     | YES          |  
| public       | student\_kpi\_snapshots        | postgres      | SELECT         | YES          |  
| public       | student\_kpi\_snapshots        | postgres      | TRIGGER        | YES          |  
| public       | student\_kpi\_snapshots        | postgres      | TRUNCATE       | YES          |  
| public       | student\_kpi\_snapshots        | postgres      | UPDATE         | YES          |  
| public       | student\_kpi\_snapshots        | service\_role  | DELETE         | NO           |  
| public       | student\_kpi\_snapshots        | service\_role  | INSERT         | NO           |  
| public       | student\_kpi\_snapshots        | service\_role  | REFERENCES     | NO           |  
| public       | student\_kpi\_snapshots        | service\_role  | SELECT         | NO           |  
| public       | student\_kpi\_snapshots        | service\_role  | TRIGGER        | NO           |  
| public       | student\_kpi\_snapshots        | service\_role  | TRUNCATE       | NO           |  
| public       | student\_kpi\_snapshots        | service\_role  | UPDATE         | NO           |  
| public       | student\_question\_attempts    | anon          | DELETE         | NO           |  
| public       | student\_question\_attempts    | anon          | INSERT         | NO           |  
| public       | student\_question\_attempts    | anon          | REFERENCES     | NO           |  
| public       | student\_question\_attempts    | anon          | SELECT         | NO           |  
| public       | student\_question\_attempts    | anon          | TRIGGER        | NO           |  
| public       | student\_question\_attempts    | anon          | TRUNCATE       | NO           |  
| public       | student\_question\_attempts    | anon          | UPDATE         | NO           |  
| public       | student\_question\_attempts    | authenticated | DELETE         | NO           |  
| public       | student\_question\_attempts    | authenticated | INSERT         | NO           |  
| public       | student\_question\_attempts    | authenticated | REFERENCES     | NO           |  
| public       | student\_question\_attempts    | authenticated | SELECT         | NO           |  
| public       | student\_question\_attempts    | authenticated | TRIGGER        | NO           |  
| public       | student\_question\_attempts    | authenticated | TRUNCATE       | NO           |  
| public       | student\_question\_attempts    | authenticated | UPDATE         | NO           |  
| public       | student\_question\_attempts    | postgres      | DELETE         | YES          |  
| public       | student\_question\_attempts    | postgres      | INSERT         | YES          |  
| public       | student\_question\_attempts    | postgres      | REFERENCES     | YES          |  
| public       | student\_question\_attempts    | postgres      | SELECT         | YES          |  
| public       | student\_question\_attempts    | postgres      | TRIGGER        | YES          |  
| public       | student\_question\_attempts    | postgres      | TRUNCATE       | YES          |  
| public       | student\_question\_attempts    | postgres      | UPDATE         | YES          |  
| public       | student\_question\_attempts    | service\_role  | DELETE         | NO           |  
| public       | student\_question\_attempts    | service\_role  | INSERT         | NO           |  
| public       | student\_question\_attempts    | service\_role  | REFERENCES     | NO           |  
| public       | student\_question\_attempts    | service\_role  | SELECT         | NO           |  
| public       | student\_question\_attempts    | service\_role  | TRIGGER        | NO           |  
| public       | student\_question\_attempts    | service\_role  | TRUNCATE       | NO           |  
| public       | student\_question\_attempts    | service\_role  | UPDATE         | NO           |  
| public       | student\_section\_projections  | anon          | DELETE         | NO           |  
| public       | student\_section\_projections  | anon          | INSERT         | NO           |  
| public       | student\_section\_projections  | anon          | REFERENCES     | NO           |  
| public       | student\_section\_projections  | anon          | SELECT         | NO           |  
| public       | student\_section\_projections  | anon          | TRIGGER        | NO           |  
| public       | student\_section\_projections  | anon          | TRUNCATE       | NO           |  
| public       | student\_section\_projections  | anon          | UPDATE         | NO           |  
| public       | student\_section\_projections  | authenticated | DELETE         | NO           |  
| public       | student\_section\_projections  | authenticated | INSERT         | NO           |  
| public       | student\_section\_projections  | authenticated | REFERENCES     | NO           |  
| public       | student\_section\_projections  | authenticated | SELECT         | NO           |  
| public       | student\_section\_projections  | authenticated | TRIGGER        | NO           |  
| public       | student\_section\_projections  | authenticated | TRUNCATE       | NO           |  
| public       | student\_section\_projections  | authenticated | UPDATE         | NO           |  
| public       | student\_section\_projections  | postgres      | DELETE         | YES          |  
| public       | student\_section\_projections  | postgres      | INSERT         | YES          |  
| public       | student\_section\_projections  | postgres      | REFERENCES     | YES          |  
| public       | student\_section\_projections  | postgres      | SELECT         | YES          |  
| public       | student\_section\_projections  | postgres      | TRIGGER        | YES          |  
| public       | student\_section\_projections  | postgres      | TRUNCATE       | YES          |  
| public       | student\_section\_projections  | postgres      | UPDATE         | YES          |  
| public       | student\_section\_projections  | service\_role  | DELETE         | NO           |  
| public       | student\_section\_projections  | service\_role  | INSERT         | NO           |  
| public       | student\_section\_projections  | service\_role  | REFERENCES     | NO           |  
| public       | student\_section\_projections  | service\_role  | SELECT         | NO           |  
| public       | student\_section\_projections  | service\_role  | TRIGGER        | NO           |  
| public       | student\_section\_projections  | service\_role  | TRUNCATE       | NO           |  
| public       | student\_section\_projections  | service\_role  | UPDATE         | NO           |  
| public       | student\_skill\_mastery        | anon          | DELETE         | NO           |  
| public       | student\_skill\_mastery        | anon          | INSERT         | NO           |  
| public       | student\_skill\_mastery        | anon          | REFERENCES     | NO           |  
| public       | student\_skill\_mastery        | anon          | SELECT         | NO           |  
| public       | student\_skill\_mastery        | anon          | TRIGGER        | NO           |  
| public       | student\_skill\_mastery        | anon          | TRUNCATE       | NO           |  
| public       | student\_skill\_mastery        | anon          | UPDATE         | NO           |  
| public       | student\_skill\_mastery        | authenticated | DELETE         | NO           |  
| public       | student\_skill\_mastery        | authenticated | INSERT         | NO           |  
| public       | student\_skill\_mastery        | authenticated | REFERENCES     | NO           |  
| public       | student\_skill\_mastery        | authenticated | SELECT         | NO           |  
| public       | student\_skill\_mastery        | authenticated | TRIGGER        | NO           |  
| public       | student\_skill\_mastery        | authenticated | TRUNCATE       | NO           |  
| public       | student\_skill\_mastery        | authenticated | UPDATE         | NO           |  
| public       | student\_skill\_mastery        | postgres      | DELETE         | YES          |  
| public       | student\_skill\_mastery        | postgres      | INSERT         | YES          |  
| public       | student\_skill\_mastery        | postgres      | REFERENCES     | YES          |  
| public       | student\_skill\_mastery        | postgres      | SELECT         | YES          |  
| public       | student\_skill\_mastery        | postgres      | TRIGGER        | YES          |  
| public       | student\_skill\_mastery        | postgres      | TRUNCATE       | YES          |  
| public       | student\_skill\_mastery        | postgres      | UPDATE         | YES          |  
| public       | student\_skill\_mastery        | service\_role  | DELETE         | NO           |  
| public       | student\_skill\_mastery        | service\_role  | INSERT         | NO           |  
| public       | student\_skill\_mastery        | service\_role  | REFERENCES     | NO           |  
| public       | student\_skill\_mastery        | service\_role  | SELECT         | NO           |  
| public       | student\_skill\_mastery        | service\_role  | TRIGGER        | NO           |  
| public       | student\_skill\_mastery        | service\_role  | TRUNCATE       | NO           |  
| public       | student\_skill\_mastery        | service\_role  | UPDATE         | NO           |  
| public       | user\_competencies            | anon          | DELETE         | NO           |  
| public       | user\_competencies            | anon          | INSERT         | NO           |  
| public       | user\_competencies            | anon          | REFERENCES     | NO           |  
| public       | user\_competencies            | anon          | SELECT         | NO           |  
| public       | user\_competencies            | anon          | TRIGGER        | NO           |  
| public       | user\_competencies            | anon          | TRUNCATE       | NO           |  
| public       | user\_competencies            | anon          | UPDATE         | NO           |  
| public       | user\_competencies            | authenticated | DELETE         | NO           |  
| public       | user\_competencies            | authenticated | INSERT         | NO           |  
| public       | user\_competencies            | authenticated | REFERENCES     | NO           |  
| public       | user\_competencies            | authenticated | SELECT         | NO           |  
| public       | user\_competencies            | authenticated | TRIGGER        | NO           |  
| public       | user\_competencies            | authenticated | TRUNCATE       | NO           |  
| public       | user\_competencies            | authenticated | UPDATE         | NO           |  
| public       | user\_competencies            | postgres      | DELETE         | YES          |  
| public       | user\_competencies            | postgres      | INSERT         | YES          |  
| public       | user\_competencies            | postgres      | REFERENCES     | YES          |  
| public       | user\_competencies            | postgres      | SELECT         | YES          |  
| public       | user\_competencies            | postgres      | TRIGGER        | YES          |  
| public       | user\_competencies            | postgres      | TRUNCATE       | YES          |  
| public       | user\_competencies            | postgres      | UPDATE         | YES          |  
| public       | user\_competencies            | service\_role  | DELETE         | NO           |  
| public       | user\_competencies            | service\_role  | INSERT         | NO           |  
| public       | user\_competencies            | service\_role  | REFERENCES     | NO           |  
| public       | user\_competencies            | service\_role  | SELECT         | NO           |  
| public       | user\_competencies            | service\_role  | TRIGGER        | NO           |  
| public       | user\_competencies            | service\_role  | TRUNCATE       | NO           |  
| public       | user\_competencies            | service\_role  | UPDATE         | NO           |

| routine\_schema | routine\_name                                   | grantee       | privilege\_type | is\_grantable |  
| \-------------- | \---------------------------------------------- | \------------- | \-------------- | \------------ |  
| public         | apply\_learning\_event\_to\_mastery                | PUBLIC        | EXECUTE        | NO           |  
| public         | apply\_learning\_event\_to\_mastery                | anon          | EXECUTE        | NO           |  
| public         | apply\_learning\_event\_to\_mastery                | authenticated | EXECUTE        | NO           |  
| public         | apply\_learning\_event\_to\_mastery                | postgres      | EXECUTE        | YES          |  
| public         | apply\_learning\_event\_to\_mastery                | service\_role  | EXECUTE        | NO           |  
| public         | audit\_kpi\_constants\_changes                    | PUBLIC        | EXECUTE        | NO           |  
| public         | audit\_kpi\_constants\_changes                    | anon          | EXECUTE        | NO           |  
| public         | audit\_kpi\_constants\_changes                    | authenticated | EXECUTE        | NO           |  
| public         | audit\_kpi\_constants\_changes                    | postgres      | EXECUTE        | YES          |  
| public         | audit\_kpi\_constants\_changes                    | service\_role  | EXECUTE        | NO           |  
| public         | audit\_mastery\_constants\_changes                | PUBLIC        | EXECUTE        | NO           |  
| public         | audit\_mastery\_constants\_changes                | anon          | EXECUTE        | NO           |  
| public         | audit\_mastery\_constants\_changes                | authenticated | EXECUTE        | NO           |  
| public         | audit\_mastery\_constants\_changes                | postgres      | EXECUTE        | YES          |  
| public         | audit\_mastery\_constants\_changes                | service\_role  | EXECUTE        | NO           |  
| public         | compute\_projection\_delta                       | PUBLIC        | EXECUTE        | NO           |  
| public         | compute\_projection\_delta                       | anon          | EXECUTE        | NO           |  
| public         | compute\_projection\_delta                       | authenticated | EXECUTE        | NO           |  
| public         | compute\_projection\_delta                       | postgres      | EXECUTE        | YES          |  
| public         | compute\_projection\_delta                       | service\_role  | EXECUTE        | NO           |  
| public         | get\_difficulty\_multiplier                      | PUBLIC        | EXECUTE        | NO           |  
| public         | get\_difficulty\_multiplier                      | anon          | EXECUTE        | NO           |  
| public         | get\_difficulty\_multiplier                      | authenticated | EXECUTE        | NO           |  
| public         | get\_difficulty\_multiplier                      | postgres      | EXECUTE        | YES          |  
| public         | get\_difficulty\_multiplier                      | service\_role  | EXECUTE        | NO           |  
| public         | get\_kpi\_live\_row                               | PUBLIC        | EXECUTE        | NO           |  
| public         | get\_kpi\_live\_row                               | anon          | EXECUTE        | NO           |  
| public         | get\_kpi\_live\_row                               | authenticated | EXECUTE        | NO           |  
| public         | get\_kpi\_live\_row                               | postgres      | EXECUTE        | YES          |  
| public         | get\_kpi\_live\_row                               | service\_role  | EXECUTE        | NO           |  
| public         | get\_mastery\_constant\_num                       | PUBLIC        | EXECUTE        | NO           |  
| public         | get\_mastery\_constant\_num                       | anon          | EXECUTE        | NO           |  
| public         | get\_mastery\_constant\_num                       | authenticated | EXECUTE        | NO           |  
| public         | get\_mastery\_constant\_num                       | postgres      | EXECUTE        | YES          |  
| public         | get\_mastery\_constant\_num                       | service\_role  | EXECUTE        | NO           |  
| public         | map\_mastery\_level                              | PUBLIC        | EXECUTE        | NO           |  
| public         | map\_mastery\_level                              | anon          | EXECUTE        | NO           |  
| public         | map\_mastery\_level                              | authenticated | EXECUTE        | NO           |  
| public         | map\_mastery\_level                              | postgres      | EXECUTE        | YES          |  
| public         | map\_mastery\_level                              | service\_role  | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket                    | PUBLIC        | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket                    | anon          | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket                    | authenticated | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket                    | postgres      | EXECUTE        | YES          |  
| public         | normalize\_difficulty\_bucket                    | service\_role  | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket\_from\_jsonb         | PUBLIC        | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket\_from\_jsonb         | anon          | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket\_from\_jsonb         | authenticated | EXECUTE        | NO           |  
| public         | normalize\_difficulty\_bucket\_from\_jsonb         | postgres      | EXECUTE        | YES          |  
| public         | normalize\_difficulty\_bucket\_from\_jsonb         | service\_role  | EXECUTE        | NO           |  
| public         | rebuild\_mastery\_and\_kpis                       | PUBLIC        | EXECUTE        | NO           |  
| public         | rebuild\_mastery\_and\_kpis                       | anon          | EXECUTE        | NO           |  
| public         | rebuild\_mastery\_and\_kpis                       | authenticated | EXECUTE        | NO           |  
| public         | rebuild\_mastery\_and\_kpis                       | postgres      | EXECUTE        | YES          |  
| public         | rebuild\_mastery\_and\_kpis                       | service\_role  | EXECUTE        | NO           |  
| public         | refresh\_domain\_mastery\_for\_student\_domain      | PUBLIC        | EXECUTE        | NO           |  
| public         | refresh\_domain\_mastery\_for\_student\_domain      | anon          | EXECUTE        | NO           |  
| public         | refresh\_domain\_mastery\_for\_student\_domain      | authenticated | EXECUTE        | NO           |  
| public         | refresh\_domain\_mastery\_for\_student\_domain      | postgres      | EXECUTE        | YES          |  
| public         | refresh\_domain\_mastery\_for\_student\_domain      | service\_role  | EXECUTE        | NO           |  
| public         | refresh\_section\_projection\_for\_student\_section | PUBLIC        | EXECUTE        | NO           |  
| public         | refresh\_section\_projection\_for\_student\_section | anon          | EXECUTE        | NO           |  
| public         | refresh\_section\_projection\_for\_student\_section | authenticated | EXECUTE        | NO           |  
| public         | refresh\_section\_projection\_for\_student\_section | postgres      | EXECUTE        | YES          |  
| public         | refresh\_section\_projection\_for\_student\_section | service\_role  | EXECUTE        | NO           |  
| public         | upsert\_cluster\_mastery                         | PUBLIC        | EXECUTE        | NO           |  
| public         | upsert\_cluster\_mastery                         | anon          | EXECUTE        | NO           |  
| public         | upsert\_cluster\_mastery                         | authenticated | EXECUTE        | NO           |  
| public         | upsert\_cluster\_mastery                         | postgres      | EXECUTE        | YES          |  
| public         | upsert\_cluster\_mastery                         | service\_role  | EXECUTE        | NO           |  
| public         | upsert\_skill\_mastery                           | PUBLIC        | EXECUTE        | NO           |  
| public         | upsert\_skill\_mastery                           | anon          | EXECUTE        | NO           |  
| public         | upsert\_skill\_mastery                           | authenticated | EXECUTE        | NO           |  
| public         | upsert\_skill\_mastery                           | postgres      | EXECUTE        | YES          |  
| public         | upsert\_skill\_mastery                           | service\_role  | EXECUTE        | NO           |  
| public         | upsert\_student\_kpi\_counters\_current            | PUBLIC        | EXECUTE        | NO           |  
| public         | upsert\_student\_kpi\_counters\_current            | anon          | EXECUTE        | NO           |  
| public         | upsert\_student\_kpi\_counters\_current            | authenticated | EXECUTE        | NO           |  
| public         | upsert\_student\_kpi\_counters\_current            | postgres      | EXECUTE        | YES          |  
| public         | upsert\_student\_kpi\_counters\_current            | service\_role  | EXECUTE        | NO           |

| table\_schema | table\_name                   | trigger\_name                                | trigger\_enabled | trigger\_definition                                                                                                                                      | function\_schema | function\_name            |  
| \------------ | \---------------------------- | \------------------------------------------- | \--------------- | \------------------------------------------------------------------------------------------------------------------------------------------------------- | \--------------- | \------------------------ |  
| public       | practice\_sessions            | tr\_practice\_sessions\_updated\_at             | enabled         | CREATE TRIGGER tr\_practice\_sessions\_updated\_at BEFORE UPDATE ON practice\_sessions FOR EACH ROW EXECUTE FUNCTION handle\_updated\_at()                     | public          | handle\_updated\_at        |  
| public       | practice\_sessions            | update\_practice\_sessions\_updated\_at         | enabled         | CREATE TRIGGER update\_practice\_sessions\_updated\_at BEFORE UPDATE ON practice\_sessions FOR EACH ROW EXECUTE FUNCTION update\_updated\_at\_column()          | public          | update\_updated\_at\_column |  
| public       | student\_kpi\_counters\_current | set\_student\_kpi\_counters\_current\_updated\_at | enabled         | CREATE TRIGGER set\_student\_kpi\_counters\_current\_updated\_at BEFORE UPDATE ON student\_kpi\_counters\_current FOR EACH ROW EXECUTE FUNCTION set\_updated\_at() | public          | set\_updated\_at           |  
| public       | student\_kpi\_snapshots        | set\_student\_kpi\_snapshots\_updated\_at        | enabled         | CREATE TRIGGER set\_student\_kpi\_snapshots\_updated\_at BEFORE UPDATE ON student\_kpi\_snapshots FOR EACH ROW EXECUTE FUNCTION set\_updated\_at()               | public          | set\_updated\_at           |  
| public       | student\_skill\_mastery        | trg\_student\_skill\_mastery\_updated\_at        | enabled         | CREATE TRIGGER trg\_student\_skill\_mastery\_updated\_at BEFORE UPDATE ON student\_skill\_mastery FOR EACH ROW EXECUTE FUNCTION set\_updated\_at()               | public          | set\_updated\_at           |

| object\_type | schema\_name | table\_name                   | object\_name                                               | object\_subtype | definition                                                                                                                                                                                                                        |  
| \----------- | \----------- | \---------------------------- | \--------------------------------------------------------- | \-------------- | \--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_outcome\_check                             | c              | CHECK (outcome IS NULL OR (outcome \= ANY (ARRAY\['correct'::text, 'incorrect'::text, 'skipped'::text\])))                                                                                                                           |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_outcome\_check\_v2                          | c              | CHECK (outcome \= ANY (ARRAY\['correct'::text, 'incorrect'::text, 'skipped'::text\]))                                                                                                                                                |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_pkey                                      | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_question\_id\_fkey                          | f              | FOREIGN KEY (question\_id) REFERENCES questions(id) ON DELETE CASCADE                                                                                                                                                              |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_session\_id\_fkey                           | f              | FOREIGN KEY (session\_id) REFERENCES practice\_sessions(id) ON DELETE CASCADE                                                                                                                                                       |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_session\_item\_id\_fkey                      | f              | FOREIGN KEY (session\_item\_id) REFERENCES practice\_session\_items(id) ON DELETE SET NULL                                                                                                                                            |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_session\_question\_unique                   | u              | UNIQUE (session\_id, question\_id)                                                                                                                                                                                                  |  
| constraint  | public      | answer\_attempts              | answer\_attempts\_user\_id\_fkey                              | f              | FOREIGN KEY (user\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                                 |  
| index       | public      | answer\_attempts              | answer\_attempts\_pkey                                      | unique\_index   | CREATE UNIQUE INDEX answer\_attempts\_pkey ON public.answer\_attempts USING btree (id)                                                                                                                                               |  
| index       | public      | answer\_attempts              | answer\_attempts\_question\_id\_idx                           | index          | CREATE INDEX answer\_attempts\_question\_id\_idx ON public.answer\_attempts USING btree (question\_id)                                                                                                                                  |  
| index       | public      | answer\_attempts              | answer\_attempts\_session\_id\_idx                            | index          | CREATE INDEX answer\_attempts\_session\_id\_idx ON public.answer\_attempts USING btree (session\_id)                                                                                                                                    |  
| index       | public      | answer\_attempts              | answer\_attempts\_session\_question\_uniq                     | unique\_index   | CREATE UNIQUE INDEX answer\_attempts\_session\_question\_uniq ON public.answer\_attempts USING btree (session\_id, question\_id)                                                                                                         |  
| index       | public      | answer\_attempts              | answer\_attempts\_session\_question\_unique                   | unique\_index   | CREATE UNIQUE INDEX answer\_attempts\_session\_question\_unique ON public.answer\_attempts USING btree (session\_id, question\_id)                                                                                                       |  
| index       | public      | answer\_attempts              | answer\_attempts\_user\_id\_idx                               | index          | CREATE INDEX answer\_attempts\_user\_id\_idx ON public.answer\_attempts USING btree (user\_id)                                                                                                                                          |  
| index       | public      | answer\_attempts              | idx\_answer\_attempts\_question\_id                           | index          | CREATE INDEX idx\_answer\_attempts\_question\_id ON public.answer\_attempts USING btree (question\_id)                                                                                                                                  |  
| index       | public      | answer\_attempts              | idx\_answer\_attempts\_session\_id                            | index          | CREATE INDEX idx\_answer\_attempts\_session\_id ON public.answer\_attempts USING btree (session\_id)                                                                                                                                    |  
| index       | public      | answer\_attempts              | idx\_answer\_attempts\_session\_item\_id                       | index          | CREATE INDEX idx\_answer\_attempts\_session\_item\_id ON public.answer\_attempts USING btree (session\_item\_id) WHERE (session\_item\_id IS NOT NULL)                                                                                      |  
| index       | public      | answer\_attempts              | idx\_answer\_attempts\_user\_id                               | index          | CREATE INDEX idx\_answer\_attempts\_user\_id ON public.answer\_attempts USING btree (user\_id)                                                                                                                                          |  
| index       | public      | answer\_attempts              | uq\_answer\_attempts\_session\_item\_id                        | unique\_index   | CREATE UNIQUE INDEX uq\_answer\_attempts\_session\_item\_id ON public.answer\_attempts USING btree (session\_item\_id) WHERE (session\_item\_id IS NOT NULL)                                                                                |  
| index       | public      | answer\_attempts              | uq\_answer\_attempts\_session\_question                       | unique\_index   | CREATE UNIQUE INDEX uq\_answer\_attempts\_session\_question ON public.answer\_attempts USING btree (session\_id, question\_id)                                                                                                           |  
| index       | public      | answer\_attempts              | uq\_answer\_attempts\_user\_client\_attempt                    | unique\_index   | CREATE UNIQUE INDEX uq\_answer\_attempts\_user\_client\_attempt ON public.answer\_attempts USING btree (user\_id, client\_attempt\_id) WHERE (client\_attempt\_id IS NOT NULL)                                                               |  
| index       | public      | answer\_attempts              | ux\_answer\_attempts\_session\_question                       | unique\_index   | CREATE UNIQUE INDEX ux\_answer\_attempts\_session\_question ON public.answer\_attempts USING btree (session\_id, question\_id)                                                                                                           |  
| constraint  | public      | competency\_events            | competency\_events\_pkey                                    | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| index       | public      | competency\_events            | competency\_events\_pkey                                    | unique\_index   | CREATE UNIQUE INDEX competency\_events\_pkey ON public.competency\_events USING btree (id)                                                                                                                                           |  
| index       | public      | competency\_events            | competency\_events\_user\_competency\_idx                     | index          | CREATE INDEX competency\_events\_user\_competency\_idx ON public.competency\_events USING btree (user\_id, competency)                                                                                                                  |  
| index       | public      | competency\_events            | competency\_events\_user\_created\_at\_idx                     | index          | CREATE INDEX competency\_events\_user\_created\_at\_idx ON public.competency\_events USING btree (user\_id, created\_at DESC)                                                                                                             |  
| index       | public      | competency\_events            | competency\_events\_user\_id\_created\_at\_idx                  | index          | CREATE INDEX competency\_events\_user\_id\_created\_at\_idx ON public.competency\_events USING btree (user\_id, created\_at DESC)                                                                                                          |  
| index       | public      | competency\_events            | idx\_competency\_events\_user\_occurred                       | index          | CREATE INDEX idx\_competency\_events\_user\_occurred ON public.competency\_events USING btree (user\_id, occurred\_at DESC)                                                                                                              |  
| constraint  | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_module\_id\_fkey                 | f              | FOREIGN KEY (module\_id) REFERENCES full\_length\_exam\_modules(id) ON DELETE CASCADE                                                                                                                                                 |  
| constraint  | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_pkey                           | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_question\_id\_fkey               | f              | FOREIGN KEY (question\_id) REFERENCES questions(id) ON DELETE CASCADE                                                                                                                                                              |  
| constraint  | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_unique\_module\_order            | u              | UNIQUE (module\_id, order\_index)                                                                                                                                                                                                   |  
| constraint  | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_unique\_module\_question         | u              | UNIQUE (module\_id, question\_id)                                                                                                                                                                                                   |  
| index       | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_module\_idx                     | index          | CREATE INDEX full\_length\_exam\_questions\_module\_idx ON public.full\_length\_exam\_questions USING btree (module\_id)                                                                                                                   |  
| index       | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_pkey                           | unique\_index   | CREATE UNIQUE INDEX full\_length\_exam\_questions\_pkey ON public.full\_length\_exam\_questions USING btree (id)                                                                                                                         |  
| index       | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_unique\_module\_order            | unique\_index   | CREATE UNIQUE INDEX full\_length\_exam\_questions\_unique\_module\_order ON public.full\_length\_exam\_questions USING btree (module\_id, order\_index)                                                                                      |  
| index       | public      | full\_length\_exam\_questions   | full\_length\_exam\_questions\_unique\_module\_question         | unique\_index   | CREATE UNIQUE INDEX full\_length\_exam\_questions\_unique\_module\_question ON public.full\_length\_exam\_questions USING btree (module\_id, question\_id)                                                                                   |  
| constraint  | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_module\_id\_fkey                 | f              | FOREIGN KEY (module\_id) REFERENCES full\_length\_exam\_modules(id) ON DELETE CASCADE                                                                                                                                                 |  
| constraint  | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_pkey                           | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_question\_id\_fkey               | f              | FOREIGN KEY (question\_id) REFERENCES questions(id) ON DELETE CASCADE                                                                                                                                                              |  
| constraint  | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_session\_id\_fkey                | f              | FOREIGN KEY (session\_id) REFERENCES full\_length\_exam\_sessions(id) ON DELETE CASCADE                                                                                                                                               |  
| constraint  | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_unique\_session\_module\_question | u              | UNIQUE (session\_id, module\_id, question\_id)                                                                                                                                                                                       |  
| index       | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_pkey                           | unique\_index   | CREATE UNIQUE INDEX full\_length\_exam\_responses\_pkey ON public.full\_length\_exam\_responses USING btree (id)                                                                                                                         |  
| index       | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_session\_module\_idx             | index          | CREATE INDEX full\_length\_exam\_responses\_session\_module\_idx ON public.full\_length\_exam\_responses USING btree (session\_id, module\_id)                                                                                               |  
| index       | public      | full\_length\_exam\_responses   | full\_length\_exam\_responses\_unique\_session\_module\_question | unique\_index   | CREATE UNIQUE INDEX full\_length\_exam\_responses\_unique\_session\_module\_question ON public.full\_length\_exam\_responses USING btree (session\_id, module\_id, question\_id)                                                               |  
| constraint  | public      | full\_length\_exam\_sessions    | full\_length\_exam\_sessions\_pkey                            | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | full\_length\_exam\_sessions    | full\_length\_exam\_sessions\_test\_form\_id\_fkey               | f              | FOREIGN KEY (test\_form\_id) REFERENCES test\_forms(id) ON DELETE RESTRICT                                                                                                                                                           |  
| constraint  | public      | full\_length\_exam\_sessions    | full\_length\_exam\_sessions\_user\_id\_fkey                    | f              | FOREIGN KEY (user\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                                 |  
| index       | public      | full\_length\_exam\_sessions    | full\_length\_exam\_sessions\_one\_active\_per\_user             | unique\_index   | CREATE UNIQUE INDEX full\_length\_exam\_sessions\_one\_active\_per\_user ON public.full\_length\_exam\_sessions USING btree (user\_id) WHERE (status \= ANY (ARRAY\['not\_started'::text, 'in\_progress'::text, 'break'::text\]))                 |  
| index       | public      | full\_length\_exam\_sessions    | full\_length\_exam\_sessions\_pkey                            | unique\_index   | CREATE UNIQUE INDEX full\_length\_exam\_sessions\_pkey ON public.full\_length\_exam\_sessions USING btree (id)                                                                                                                           |  
| index       | public      | full\_length\_exam\_sessions    | idx\_full\_length\_exam\_sessions\_test\_form\_id                | index          | CREATE INDEX idx\_full\_length\_exam\_sessions\_test\_form\_id ON public.full\_length\_exam\_sessions USING btree (test\_form\_id)                                                                                                            |  
| index       | public      | full\_length\_exam\_sessions    | idx\_full\_length\_exam\_sessions\_user\_client\_active          | index          | CREATE INDEX idx\_full\_length\_exam\_sessions\_user\_client\_active ON public.full\_length\_exam\_sessions USING btree (user\_id, client\_instance\_id) WHERE (status \= ANY (ARRAY\['not\_started'::text, 'in\_progress'::text, 'break'::text\])) |  
| index       | public      | full\_length\_exam\_sessions    | idx\_one\_active\_exam\_session\_per\_user                      | unique\_index   | CREATE UNIQUE INDEX idx\_one\_active\_exam\_session\_per\_user ON public.full\_length\_exam\_sessions USING btree (user\_id) WHERE (status \= ANY (ARRAY\['not\_started'::text, 'in\_progress'::text, 'break'::text\]))                          |  
| index       | public      | full\_length\_exam\_sessions    | uq\_full\_length\_exam\_sessions\_user\_form\_active             | unique\_index   | CREATE UNIQUE INDEX uq\_full\_length\_exam\_sessions\_user\_form\_active ON public.full\_length\_exam\_sessions USING btree (user\_id, test\_form\_id) WHERE (status \= ANY (ARRAY\['not\_started'::text, 'in\_progress'::text, 'break'::text\]))   |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_ordinal\_check                      | c              | CHECK (ordinal \> 0\)                                                                                                                                                                                                               |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_outcome\_check                      | c              | CHECK (outcome IS NULL OR (outcome \= ANY (ARRAY\['correct'::text, 'incorrect'::text, 'skipped'::text\])))                                                                                                                           |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_pkey                               | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_question\_canonical\_id\_fkey         | f              | FOREIGN KEY (question\_canonical\_id) REFERENCES questions(canonical\_id) ON DELETE RESTRICT                                                                                                                                         |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_question\_id\_fkey                   | f              | FOREIGN KEY (question\_id) REFERENCES questions(id) ON DELETE RESTRICT                                                                                                                                                             |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_session\_id\_fkey                    | f              | FOREIGN KEY (session\_id) REFERENCES practice\_sessions(id) ON DELETE CASCADE                                                                                                                                                       |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_status\_check                       | c              | CHECK (status \= ANY (ARRAY\['queued'::text, 'served'::text, 'answered'::text, 'skipped'::text\]))                                                                                                                                   |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_time\_spent\_ms\_check                | c              | CHECK (time\_spent\_ms IS NULL OR time\_spent\_ms \>= 0\)                                                                                                                                                                               |  
| constraint  | public      | practice\_session\_items       | practice\_session\_items\_user\_id\_fkey                       | f              | FOREIGN KEY (user\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                                 |  
| index       | public      | practice\_session\_items       | idx\_practice\_session\_items\_question\_canonical\_id          | index          | CREATE INDEX idx\_practice\_session\_items\_question\_canonical\_id ON public.practice\_session\_items USING btree (question\_canonical\_id)                                                                                                |  
| index       | public      | practice\_session\_items       | idx\_practice\_session\_items\_question\_id                    | index          | CREATE INDEX idx\_practice\_session\_items\_question\_id ON public.practice\_session\_items USING btree (question\_id)                                                                                                                    |  
| index       | public      | practice\_session\_items       | idx\_practice\_session\_items\_session\_status\_ordinal         | index          | CREATE INDEX idx\_practice\_session\_items\_session\_status\_ordinal ON public.practice\_session\_items USING btree (session\_id, status, ordinal DESC)                                                                                    |  
| index       | public      | practice\_session\_items       | idx\_practice\_session\_items\_user\_answered\_at               | index          | CREATE INDEX idx\_practice\_session\_items\_user\_answered\_at ON public.practice\_session\_items USING btree (user\_id, answered\_at DESC)                                                                                                 |  
| index       | public      | practice\_session\_items       | idx\_practice\_session\_items\_user\_created\_at                | index          | CREATE INDEX idx\_practice\_session\_items\_user\_created\_at ON public.practice\_session\_items USING btree (user\_id, created\_at DESC)                                                                                                   |  
| index       | public      | practice\_session\_items       | practice\_session\_items\_pkey                               | unique\_index   | CREATE UNIQUE INDEX practice\_session\_items\_pkey ON public.practice\_session\_items USING btree (id)                                                                                                                                 |  
| index       | public      | practice\_session\_items       | uq\_practice\_session\_items\_session\_ordinal                 | unique\_index   | CREATE UNIQUE INDEX uq\_practice\_session\_items\_session\_ordinal ON public.practice\_session\_items USING btree (session\_id, ordinal)                                                                                                  |  
| index       | public      | practice\_session\_items       | uq\_practice\_session\_items\_single\_unanswered               | unique\_index   | CREATE UNIQUE INDEX uq\_practice\_session\_items\_single\_unanswered ON public.practice\_session\_items USING btree (session\_id) WHERE (status \= 'served'::text)                                                                         |  
| index       | public      | practice\_session\_items       | uq\_practice\_session\_items\_user\_client\_attempt             | unique\_index   | CREATE UNIQUE INDEX uq\_practice\_session\_items\_user\_client\_attempt ON public.practice\_session\_items USING btree (user\_id, client\_attempt\_id) WHERE (client\_attempt\_id IS NOT NULL)                                                 |  
| constraint  | public      | practice\_sessions            | practice\_sessions\_pkey                                    | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | practice\_sessions            | practice\_sessions\_status\_check                            | c              | CHECK (status \= ANY (ARRAY\['in\_progress'::text, 'completed'::text, 'abandoned'::text\]))                                                                                                                                           |  
| constraint  | public      | practice\_sessions            | practice\_sessions\_user\_id\_fkey                            | f              | FOREIGN KEY (user\_id) REFERENCES users(id) ON DELETE CASCADE                                                                                                                                                                      |  
| index       | public      | practice\_sessions            | idx\_practice\_sessions\_status                              | index          | CREATE INDEX idx\_practice\_sessions\_status ON public.practice\_sessions USING btree (status)                                                                                                                                        |  
| index       | public      | practice\_sessions            | idx\_practice\_sessions\_user                                | index          | CREATE INDEX idx\_practice\_sessions\_user ON public.practice\_sessions USING btree (user\_id)                                                                                                                                         |  
| index       | public      | practice\_sessions            | idx\_practice\_sessions\_user\_active                         | index          | CREATE INDEX idx\_practice\_sessions\_user\_active ON public.practice\_sessions USING btree (user\_id, status, completed)                                                                                                               |  
| index       | public      | practice\_sessions            | idx\_practice\_sessions\_user\_mode\_section                   | index          | CREATE INDEX idx\_practice\_sessions\_user\_mode\_section ON public.practice\_sessions USING btree (user\_id, mode, section)                                                                                                             |  
| index       | public      | practice\_sessions            | practice\_sessions\_pkey                                    | unique\_index   | CREATE UNIQUE INDEX practice\_sessions\_pkey ON public.practice\_sessions USING btree (id)                                                                                                                                           |  
| index       | public      | practice\_sessions            | practice\_sessions\_user\_id\_idx                             | index          | CREATE INDEX practice\_sessions\_user\_id\_idx ON public.practice\_sessions USING btree (user\_id)                                                                                                                                      |  
| index       | public      | practice\_sessions            | practice\_sessions\_user\_id\_started\_at\_idx                  | index          | CREATE INDEX practice\_sessions\_user\_id\_started\_at\_idx ON public.practice\_sessions USING btree (user\_id, started\_at DESC)                                                                                                          |  
| constraint  | public      | questions                    | canonical\_id\_format\_check                                 | c              | CHECK (canonical\_id \~ '^\[A-Z0-9\]{8,}$'::text)                                                                                                                                                                                     |  
| constraint  | public      | questions                    | questions\_mc\_options\_not\_placeholders                     | c              | CHECK (question\_type \<\> 'multiple\_choice'::text OR mc\_options\_not\_placeholders(options))                                                                                                                                          |  
| constraint  | public      | questions                    | questions\_pkey                                            | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| index       | public      | questions                    | questions\_canonical\_id\_unique                             | unique\_index   | CREATE UNIQUE INDEX questions\_canonical\_id\_unique ON public.questions USING btree (canonical\_id)                                                                                                                                  |  
| index       | public      | questions                    | questions\_domain\_idx                                      | index          | CREATE INDEX questions\_domain\_idx ON public.questions USING btree (domain)                                                                                                                                                        |  
| index       | public      | questions                    | questions\_pkey                                            | unique\_index   | CREATE UNIQUE INDEX questions\_pkey ON public.questions USING btree (id)                                                                                                                                                           |  
| index       | public      | questions                    | questions\_skill\_idx                                       | index          | CREATE INDEX questions\_skill\_idx ON public.questions USING btree (skill)                                                                                                                                                          |  
| index       | public      | questions                    | questions\_test\_section\_idx                                | index          | CREATE INDEX questions\_test\_section\_idx ON public.questions USING btree (test\_code, section\_code)                                                                                                                                 |  
| constraint  | public      | review\_error\_attempts        | review\_error\_attempts\_context\_check                       | c              | CHECK (context \= 'review\_errors'::text)                                                                                                                                                                                           |  
| constraint  | public      | review\_error\_attempts        | review\_error\_attempts\_pkey                                | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | review\_error\_attempts        | review\_error\_attempts\_student\_id\_fkey                     | f              | FOREIGN KEY (student\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                              |  
| index       | public      | review\_error\_attempts        | idx\_review\_error\_attempts\_client\_id                       | unique\_index   | CREATE UNIQUE INDEX idx\_review\_error\_attempts\_client\_id ON public.review\_error\_attempts USING btree (student\_id, client\_attempt\_id) WHERE (client\_attempt\_id IS NOT NULL)                                                         |  
| index       | public      | review\_error\_attempts        | idx\_review\_error\_attempts\_student\_created                 | index          | CREATE INDEX idx\_review\_error\_attempts\_student\_created ON public.review\_error\_attempts USING btree (student\_id, created\_at DESC)                                                                                                  |  
| index       | public      | review\_error\_attempts        | idx\_review\_error\_attempts\_student\_question                | index          | CREATE INDEX idx\_review\_error\_attempts\_student\_question ON public.review\_error\_attempts USING btree (student\_id, question\_id)                                                                                                     |  
| index       | public      | review\_error\_attempts        | review\_error\_attempts\_pkey                                | unique\_index   | CREATE UNIQUE INDEX review\_error\_attempts\_pkey ON public.review\_error\_attempts USING btree (id)                                                                                                                                   |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_attempt\_id\_fkey                      | f              | FOREIGN KEY (attempt\_id) REFERENCES review\_error\_attempts(id) ON DELETE SET NULL                                                                                                                                                  |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_ordinal\_check                        | c              | CHECK (ordinal \> 0\)                                                                                                                                                                                                               |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_pkey                                 | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_question\_difficulty\_bucket\_check     | c              | CHECK (question\_difficulty\_bucket IS NULL OR (question\_difficulty\_bucket \= ANY (ARRAY\[1, 2, 3\])))                                                                                                                                 |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_retry\_mode\_check                     | c              | CHECK (retry\_mode \= ANY (ARRAY\['same\_question'::text, 'similar\_question'::text\]))                                                                                                                                                 |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_review\_session\_id\_fkey               | f              | FOREIGN KEY (review\_session\_id) REFERENCES review\_sessions(id) ON DELETE CASCADE                                                                                                                                                  |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_source\_origin\_check                  | c              | CHECK (source\_origin \= ANY (ARRAY\['practice'::text, 'full\_test'::text\]))                                                                                                                                                          |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_status\_check                         | c              | CHECK (status \= ANY (ARRAY\['queued'::text, 'served'::text, 'answered'::text, 'skipped'::text\]))                                                                                                                                   |  
| constraint  | public      | review\_session\_items         | review\_session\_items\_student\_id\_fkey                      | f              | FOREIGN KEY (student\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                              |  
| index       | public      | review\_session\_items         | idx\_review\_session\_items\_difficulty\_bucket                | index          | CREATE INDEX idx\_review\_session\_items\_difficulty\_bucket ON public.review\_session\_items USING btree (question\_difficulty\_bucket)                                                                                                   |  
| index       | public      | review\_session\_items         | idx\_review\_session\_items\_session\_status\_ordinal           | index          | CREATE INDEX idx\_review\_session\_items\_session\_status\_ordinal ON public.review\_session\_items USING btree (review\_session\_id, status, ordinal)                                                                                      |  
| index       | public      | review\_session\_items         | review\_session\_items\_pkey                                 | unique\_index   | CREATE UNIQUE INDEX review\_session\_items\_pkey ON public.review\_session\_items USING btree (id)                                                                                                                                     |  
| index       | public      | review\_session\_items         | uq\_review\_session\_items\_session\_ordinal                   | unique\_index   | CREATE UNIQUE INDEX uq\_review\_session\_items\_session\_ordinal ON public.review\_session\_items USING btree (review\_session\_id, ordinal)                                                                                               |  
| index       | public      | review\_session\_items         | uq\_review\_session\_items\_single\_served                     | unique\_index   | CREATE UNIQUE INDEX uq\_review\_session\_items\_single\_served ON public.review\_session\_items USING btree (review\_session\_id) WHERE (status \= 'served'::text)                                                                          |  
| constraint  | public      | review\_sessions              | review\_sessions\_pkey                                      | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | review\_sessions              | review\_sessions\_status\_check                              | c              | CHECK (status \= ANY (ARRAY\['created'::text, 'active'::text, 'completed'::text, 'abandoned'::text\]))                                                                                                                               |  
| constraint  | public      | review\_sessions              | review\_sessions\_student\_id\_fkey                           | f              | FOREIGN KEY (student\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                              |  
| index       | public      | review\_sessions              | review\_sessions\_pkey                                      | unique\_index   | CREATE UNIQUE INDEX review\_sessions\_pkey ON public.review\_sessions USING btree (id)                                                                                                                                               |  
| index       | public      | review\_sessions              | uq\_review\_sessions\_single\_active                          | unique\_index   | CREATE UNIQUE INDEX uq\_review\_sessions\_single\_active ON public.review\_sessions USING btree (student\_id) WHERE (status \= ANY (ARRAY\['created'::text, 'active'::text\]))                                                             |  
| index       | public      | review\_sessions              | uq\_review\_sessions\_student\_idempotency                    | unique\_index   | CREATE UNIQUE INDEX uq\_review\_sessions\_student\_idempotency ON public.review\_sessions USING btree (student\_id, idempotency\_key) WHERE (idempotency\_key IS NOT NULL)                                                                |  
| constraint  | public      | student\_domain\_mastery       | student\_domain\_mastery\_pkey                               | p              | PRIMARY KEY (student\_id, domain)                                                                                                                                                                                                  |  
| constraint  | public      | student\_domain\_mastery       | student\_domain\_mastery\_section\_check                      | c              | CHECK (section \= ANY (ARRAY\['M'::text, 'RW'::text\]))                                                                                                                                                                              |  
| index       | public      | student\_domain\_mastery       | idx\_student\_domain\_mastery\_student                        | index          | CREATE INDEX idx\_student\_domain\_mastery\_student ON public.student\_domain\_mastery USING btree (student\_id)                                                                                                                         |  
| index       | public      | student\_domain\_mastery       | idx\_student\_domain\_mastery\_student\_section                | index          | CREATE INDEX idx\_student\_domain\_mastery\_student\_section ON public.student\_domain\_mastery USING btree (student\_id, section)                                                                                                        |  
| index       | public      | student\_domain\_mastery       | student\_domain\_mastery\_pkey                               | unique\_index   | CREATE UNIQUE INDEX student\_domain\_mastery\_pkey ON public.student\_domain\_mastery USING btree (student\_id, domain)                                                                                                                 |  
| constraint  | public      | student\_kpi\_counters\_current | student\_kpi\_counters\_current\_pkey                         | p              | PRIMARY KEY (user\_id)                                                                                                                                                                                                             |  
| constraint  | public      | student\_kpi\_counters\_current | student\_kpi\_counters\_current\_user\_id\_fkey                 | f              | FOREIGN KEY (user\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                                 |  
| index       | public      | student\_kpi\_counters\_current | idx\_student\_kpi\_counters\_current\_last\_recalculated        | index          | CREATE INDEX idx\_student\_kpi\_counters\_current\_last\_recalculated ON public.student\_kpi\_counters\_current USING btree (last\_recalculated\_at DESC NULLS LAST)                                                                         |  
| index       | public      | student\_kpi\_counters\_current | student\_kpi\_counters\_current\_pkey                         | unique\_index   | CREATE UNIQUE INDEX student\_kpi\_counters\_current\_pkey ON public.student\_kpi\_counters\_current USING btree (user\_id)                                                                                                                |  
| constraint  | public      | student\_kpi\_rollups\_current  | student\_kpi\_rollups\_current\_pkey                          | p              | PRIMARY KEY (student\_id, domain, skill, difficulty, source\_family)                                                                                                                                                                |  
| constraint  | public      | student\_kpi\_rollups\_current  | student\_kpi\_rollups\_current\_source\_family\_check           | c              | CHECK (source\_family \= ANY (ARRAY\['practice'::text, 'review'::text, 'test'::text\]))                                                                                                                                               |  
| index       | public      | student\_kpi\_rollups\_current  | idx\_student\_kpi\_rollups\_current\_student                   | index          | CREATE INDEX idx\_student\_kpi\_rollups\_current\_student ON public.student\_kpi\_rollups\_current USING btree (student\_id)                                                                                                               |  
| index       | public      | student\_kpi\_rollups\_current  | idx\_student\_kpi\_rollups\_current\_student\_domain            | index          | CREATE INDEX idx\_student\_kpi\_rollups\_current\_student\_domain ON public.student\_kpi\_rollups\_current USING btree (student\_id, domain)                                                                                                |  
| index       | public      | student\_kpi\_rollups\_current  | idx\_student\_kpi\_rollups\_current\_student\_section           | index          | CREATE INDEX idx\_student\_kpi\_rollups\_current\_student\_section ON public.student\_kpi\_rollups\_current USING btree (student\_id, section)                                                                                              |  
| index       | public      | student\_kpi\_rollups\_current  | idx\_student\_kpi\_rollups\_current\_student\_skill             | index          | CREATE INDEX idx\_student\_kpi\_rollups\_current\_student\_skill ON public.student\_kpi\_rollups\_current USING btree (student\_id, skill)                                                                                                  |  
| index       | public      | student\_kpi\_rollups\_current  | student\_kpi\_rollups\_current\_pkey                          | unique\_index   | CREATE UNIQUE INDEX student\_kpi\_rollups\_current\_pkey ON public.student\_kpi\_rollups\_current USING btree (student\_id, domain, skill, difficulty, source\_family)                                                                     |  
| constraint  | public      | student\_kpi\_snapshots        | student\_kpi\_snapshots\_pkey                                | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| constraint  | public      | student\_kpi\_snapshots        | student\_kpi\_snapshots\_user\_id\_fkey                        | f              | FOREIGN KEY (user\_id) REFERENCES auth.users(id) ON DELETE CASCADE                                                                                                                                                                 |  
| index       | public      | student\_kpi\_snapshots        | idx\_student\_kpi\_snapshots\_user\_snapshot\_at                | index          | CREATE INDEX idx\_student\_kpi\_snapshots\_user\_snapshot\_at ON public.student\_kpi\_snapshots USING btree (user\_id, snapshot\_at DESC)                                                                                                   |  
| index       | public      | student\_kpi\_snapshots        | student\_kpi\_snapshots\_pkey                                | unique\_index   | CREATE UNIQUE INDEX student\_kpi\_snapshots\_pkey ON public.student\_kpi\_snapshots USING btree (id)                                                                                                                                   |  
| constraint  | public      | student\_question\_attempts    | student\_question\_attempts\_pkey                            | p              | PRIMARY KEY (id)                                                                                                                                                                                                                  |  
| index       | public      | student\_question\_attempts    | sqa\_user\_cluster\_idx                                      | index          | CREATE INDEX sqa\_user\_cluster\_idx ON public.student\_question\_attempts USING btree (user\_id, structure\_cluster\_id)                                                                                                                 |  
| index       | public      | student\_question\_attempts    | sqa\_user\_skill\_idx                                        | index          | CREATE INDEX sqa\_user\_skill\_idx ON public.student\_question\_attempts USING btree (user\_id, section, domain, skill)                                                                                                                 |  
| index       | public      | student\_question\_attempts    | sqa\_user\_time\_idx                                         | index          | CREATE INDEX sqa\_user\_time\_idx ON public.student\_question\_attempts USING btree (user\_id, answered\_at DESC)                                                                                                                        |  
| index       | public      | student\_question\_attempts    | student\_attempts\_user\_cluster\_idx                         | index          | CREATE INDEX student\_attempts\_user\_cluster\_idx ON public.student\_question\_attempts USING btree (user\_id, structure\_cluster\_id)                                                                                                    |  
| index       | public      | student\_question\_attempts    | student\_attempts\_user\_skill\_idx                           | index          | CREATE INDEX student\_attempts\_user\_skill\_idx ON public.student\_question\_attempts USING btree (user\_id, section, domain, skill)                                                                                                    |  
| index       | public      | student\_question\_attempts    | student\_attempts\_user\_time\_idx                            | index          | CREATE INDEX student\_attempts\_user\_time\_idx ON public.student\_question\_attempts USING btree (user\_id, occurred\_at DESC)                                                                                                           |  
| index       | public      | student\_question\_attempts    | student\_question\_attempts\_pkey                            | unique\_index   | CREATE UNIQUE INDEX student\_question\_attempts\_pkey ON public.student\_question\_attempts USING btree (id)                                                                                                                           |  
| constraint  | public      | student\_section\_projections  | student\_section\_projections\_pkey                          | p              | PRIMARY KEY (student\_id, section)                                                                                                                                                                                                 |  
| constraint  | public      | student\_section\_projections  | student\_section\_projections\_section\_check                 | c              | CHECK (section \= ANY (ARRAY\['M'::text, 'RW'::text\]))                                                                                                                                                                              |  
| index       | public      | student\_section\_projections  | idx\_student\_section\_projections\_student                   | index          | CREATE INDEX idx\_student\_section\_projections\_student ON public.student\_section\_projections USING btree (student\_id)                                                                                                               |  
| index       | public      | student\_section\_projections  | student\_section\_projections\_pkey                          | unique\_index   | CREATE UNIQUE INDEX student\_section\_projections\_pkey ON public.student\_section\_projections USING btree (student\_id, section)                                                                                                      |  
| constraint  | public      | student\_skill\_mastery        | student\_skill\_mastery\_mastery\_level\_check                 | c              | CHECK (mastery\_level \>= 0 AND mastery\_level \<= 4\)                                                                                                                                                                                 |  
| constraint  | public      | student\_skill\_mastery        | student\_skill\_mastery\_pkey                                | p              | PRIMARY KEY (user\_id, section, domain, skill)                                                                                                                                                                                     |  
| index       | public      | student\_skill\_mastery        | idx\_skill\_mastery\_accuracy                                | index          | CREATE INDEX idx\_skill\_mastery\_accuracy ON public.student\_skill\_mastery USING btree (user\_id, accuracy)                                                                                                                           |  
| index       | public      | student\_skill\_mastery        | idx\_skill\_mastery\_user\_id                                 | index          | CREATE INDEX idx\_skill\_mastery\_user\_id ON public.student\_skill\_mastery USING btree (user\_id)                                                                                                                                      |  
| index       | public      | student\_skill\_mastery        | idx\_skill\_mastery\_user\_section                            | index          | CREATE INDEX idx\_skill\_mastery\_user\_section ON public.student\_skill\_mastery USING btree (user\_id, section)                                                                                                                        |  
| index       | public      | student\_skill\_mastery        | ssm\_user\_section\_idx                                      | index          | CREATE INDEX ssm\_user\_section\_idx ON public.student\_skill\_mastery USING btree (user\_id, section)                                                                                                                                  |  
| index       | public      | student\_skill\_mastery        | student\_skill\_mastery\_pkey                                | unique\_index   | CREATE UNIQUE INDEX student\_skill\_mastery\_pkey ON public.student\_skill\_mastery USING btree (user\_id, section, domain, skill)                                                                                                      |  
| index       | public      | student\_skill\_mastery        | student\_skill\_mastery\_user\_accuracy\_idx                   | index          | CREATE INDEX student\_skill\_mastery\_user\_accuracy\_idx ON public.student\_skill\_mastery USING btree (user\_id, accuracy)                                                                                                              |  
| index       | public      | student\_skill\_mastery        | student\_skill\_mastery\_user\_section\_idx                    | index          | CREATE INDEX student\_skill\_mastery\_user\_section\_idx ON public.student\_skill\_mastery USING btree (user\_id, section)                                                                                                                |  
| constraint  | public      | user\_competencies            | user\_competencies\_pkey                                    | p              | PRIMARY KEY (user\_id, competency)                                                                                                                                                                                                 |  
| index       | public      | user\_competencies            | user\_competencies\_pkey                                    | unique\_index   | CREATE UNIQUE INDEX user\_competencies\_pkey ON public.user\_competencies USING btree (user\_id, competency)                                                                                                                          |  
| index       | public      | user\_competencies            | user\_competencies\_user\_id\_score\_idx                       | index          | CREATE INDEX user\_competencies\_user\_id\_score\_idx ON public.user\_competencies USING btree (user\_id, score DESC)                                                                                                                    |  
| index       | public      | user\_competencies            | user\_competencies\_user\_score\_idx                          | index          | CREATE INDEX user\_competencies\_user\_score\_idx ON public.user\_competencies USING btree (user\_id, score DESC)                                                                                                                       |  
| sql\_to\_run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |  
| \--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |  
| select 'public.student\_skill\_mastery' as table\_name, count(\*)::bigint as row\_count from public.student\_skill\_mastery  
union all  
select 'public.student\_domain\_mastery' as table\_name, count(\*)::bigint as row\_count from public.student\_domain\_mastery  
union all  
select 'public.student\_section\_projections' as table\_name, count(\*)::bigint as row\_count from public.student\_section\_projections  
union all  
select 'public.student\_kpi\_rollups\_current' as table\_name, count(\*)::bigint as row\_count from public.student\_kpi\_rollups\_current  
union all  
select 'public.student\_kpi\_counters\_current' as table\_name, count(\*)::bigint as row\_count from public.student\_kpi\_counters\_current  
union all  
select 'public.student\_kpi\_snapshots' as table\_name, count(\*)::bigint as row\_count from public.student\_kpi\_snapshots  
union all  
select 'public.practice\_sessions' as table\_name, count(\*)::bigint as row\_count from public.practice\_sessions  
union all  
select 'public.practice\_session\_items' as table\_name, count(\*)::bigint as row\_count from public.practice\_session\_items  
union all  
select 'public.review\_sessions' as table\_name, count(\*)::bigint as row\_count from public.review\_sessions  
union all  
select 'public.review\_session\_items' as table\_name, count(\*)::bigint as row\_count from public.review\_session\_items  
union all  
select 'public.review\_error\_attempts' as table\_name, count(\*)::bigint as row\_count from public.review\_error\_attempts  
union all  
select 'public.full\_length\_exam\_sessions' as table\_name, count(\*)::bigint as row\_count from public.full\_length\_exam\_sessions  
union all  
select 'public.full\_length\_exam\_questions' as table\_name, count(\*)::bigint as row\_count from public.full\_length\_exam\_questions  
union all  
select 'public.full\_length\_exam\_responses' as table\_name, count(\*)::bigint as row\_count from public.full\_length\_exam\_responses  
union all  
select 'public.questions' as table\_name, count(\*)::bigint as row\_count from public.questions  
union all  
select 'public.user\_competencies' as table\_name, count(\*)::bigint as row\_count from public.user\_competencies  
union all  
select 'public.competency\_events' as table\_name, count(\*)::bigint as row\_count from public.competency\_events  
union all  
select 'public.student\_question\_attempts' as table\_name, count(\*)::bigint as row\_count from public.student\_question\_attempts  
union all  
select 'public.answer\_attempts' as table\_name, count(\*)::bigint as row\_count from public.answer\_attempts  
order by table\_name; |

| table\_schema | table\_name                   | approx\_live\_rows | approx\_dead\_rows | last\_analyze | last\_autoanalyze              | last\_vacuum | last\_autovacuum               |  
| \------------ | \---------------------------- | \---------------- | \---------------- | \------------ | \----------------------------- | \----------- | \----------------------------- |  
| public       | answer\_attempts              | 0                | 0                | null         | null                          | null        | null                          |  
| public       | competency\_events            | 0                | 0                | null         | null                          | null        | null                          |  
| public       | full\_length\_exam\_questions   | 0                | 0                | null         | null                          | null        | null                          |  
| public       | full\_length\_exam\_responses   | 0                | 0                | null         | null                          | null        | null                          |  
| public       | full\_length\_exam\_sessions    | 1                | 2                | null         | null                          | null        | null                          |  
| public       | practice\_session\_items       | 342              | 37               | null         | 2026-05-04 14:19:40.973864+00 | null        | 2026-05-01 00:24:28.471289+00 |  
| public       | practice\_sessions            | 82               | 35               | null         | 2026-05-01 00:24:28.437388+00 | null        | 2026-04-28 23:46:18.215286+00 |  
| public       | questions                    | 280              | 73               | null         | 2026-04-29 22:11:18.334433+00 | null        | 2026-04-29 18:35:08.50583+00  |  
| public       | review\_error\_attempts        | 7                | 0                | null         | null                          | null        | null                          |  
| public       | review\_session\_items         | 22               | 15               | null         | null                          | null        | null                          |  
| public       | review\_sessions              | 8                | 8                | null         | null                          | null        | null                          |  
| public       | student\_domain\_mastery       | 8                | 11               | null         | 2026-04-28 14:45:54.781146+00 | null        | null                          |  
| public       | student\_kpi\_counters\_current | 0                | 0                | null         | null                          | null        | null                          |  
| public       | student\_kpi\_rollups\_current  | 30               | 10               | null         | 2026-04-28 14:45:54.762507+00 | null        | null                          |  
| public       | student\_kpi\_snapshots        | 0                | 0                | null         | null                          | null        | null                          |  
| public       | student\_question\_attempts    | 0                | 0                | null         | null                          | null        | null                          |  
| public       | student\_section\_projections  | 2                | 15               | null         | 2026-04-28 14:45:54.78572+00  | null        | 2026-04-28 19:05:06.10272+00  |  
| public       | student\_skill\_mastery        | 23               | 28               | null         | 2026-04-28 14:45:54.731778+00 | null        | null                          |  
| public       | test\_answer\_submissions      | null             | null             | null         | null                          | null        | null                          |  
| public       | test\_form\_items              | null             | null             | null         | null                          | null        | null                          |  
| public       | test\_session\_answers         | null             | null             | null         | null                          | null        | null                          |  
| public       | test\_session\_sections        | null             | null             | null         | null                          | null        | null                          |  
| public       | test\_sessions                | null             | null             | null         | null                          | null        | null                          |  
| public       | user\_competencies            | 0                | 0                | null         | null                          | null        | null                          |

Audit output:

\# Mastery Source-of-Truth Audit

\#\# Executive verdict

\*\*FAIL\*\*

Repository runtime mostly uses one canonical mastery RPC choke-point, but current evidence shows Doc 04 seam violation (full-length emits mastery events) and migration-proxy DB policy conflict (\`student\_skill\_mastery\` authenticated \`FOR ALL\`).

\#\# 1\. Canonical RPC usage

| Caller | File:line | Function/route | Event type(s) | Evidence | Status |  
|---|---:|---|---|---|---|  
| \`applyLearningEventToMastery\` wrapper | \[mastery-write.ts:54\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/mastery-write.ts:54) | \`applyLearningEventToMastery\` | \`practice/review/test\` via \`sourceFamily\` | Calls \`supabase.rpc("apply\_learning\_event\_to\_mastery", ...)\` at \[mastery-write.ts:74\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/mastery-write.ts:74) | canonical |  
| Practice runtime | \[practice-canonical.ts:2257\](C:/Users/14438/projects/Lyceonai/server/routes/practice-canonical.ts:2257) | \`submitPracticeAnswer\` | practice pass/fail outcome | Calls wrapper with \`sourceFamily: "practice"\` | wrapper-only |  
| Review runtime | \[review-session-routes.ts:886\](C:/Users/14438/projects/Lyceonai/server/routes/review-session-routes.ts:886) | \`submitReviewSessionAnswer\` | review pass/fail outcome | Calls wrapper with \`sourceFamily: "review"\` | wrapper-only |  
| Full-length runtime | \[fullLengthExam.ts:1867\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:1867) | \`applyFullLengthMasterySignals\` via \`submitModule\` | test pass/fail | Wrapper called with \`sourceFamily: "test"\` | wrapper-only |

\#\# 2\. Direct writes to mastery-derived tables

| Table | Write type | File:line | Evidence | Classification |  
|---|---|---:|---|---|  
| \`student\_skill\_mastery\` | DB internal upsert | \[20251222\_student\_mastery\_tables.sql:152\](C:/Users/14438/projects/Lyceonai/supabase/migrations/20251222\_student\_mastery\_tables.sql:152) | \`INSERT ... ON CONFLICT ...\` in \`upsert\_skill\_mastery\` | allowed DB/RPC internal |  
| \`student\_skill\_mastery\` | Authenticated policy scope | \[20251222\_student\_mastery\_tables.sql:111\](C:/Users/14438/projects/Lyceonai/supabase/migrations/20251222\_student\_mastery\_tables.sql:111) | \`CREATE POLICY ... FOR ALL USING (auth.uid() \= user\_id)\` | \*\*violation\*\* |  
| \`student\_domain\_mastery\` | runtime direct write | N/A | No runtime \`.from(...).insert/update/upsert/delete\` match found | unknown |  
| \`student\_section\_projections\` | runtime direct write | N/A | No runtime \`.from(...).insert/update/upsert/delete\` match found | unknown |  
| \`student\_kpi\_rollups\_current\` | runtime direct write | N/A | Runtime reads only via canonical views | allowed derived/reporting-only |  
| \`student\_kpi\_counters\_current\` | DB internal write | \[20260327\_kpi\_contract.sql:540\](C:/Users/14438/projects/Lyceonai/supabase/migrations/20260327\_kpi\_contract.sql:540) | \`INSERT/UPDATE\` in \`upsert\_student\_kpi\_counters\_current\` | allowed DB/RPC internal |  
| \`student\_kpi\_snapshots\` | DB internal write | \[20260327\_kpi\_contract.sql:1058\](C:/Users/14438/projects/Lyceonai/supabase/migrations/20260327\_kpi\_contract.sql:1058) | Snapshot inserts inside KPI contract function flow | allowed DB/RPC internal |

\#\# 3\. Legacy / competing mastery paths

| Surface | File:line | Read/write | Runtime mounted? | Classification | Recommendation |  
|---|---:|---|---|---|---|  
| \`user\_competencies\` | none in \`server\` \+ \`apps/api/src\` | none found | no evidence | legacy/quarantine | Keep quarantined; confirm live table grants/policies via DB scripts D/E |  
| \`competency\_events\` | none in \`server\` \+ \`apps/api/src\` | none found | no evidence | legacy/quarantine | Same as above |  
| \`progress.ts\` active route | \[index.ts:341\](C:/Users/14438/projects/Lyceonai/server/index.ts:341), \[legacy/progress.ts:8\](C:/Users/14438/projects/Lyceonai/server/routes/legacy/progress.ts:8) | read (via canonical view service) | yes | derived/reporting-only | Keep read-only contract; add explicit no-write guard test if desired |  
| \`student\_question\_attempts\` | \[calendar.ts:623\](C:/Users/14438/projects/Lyceonai/apps/api/src/routes/calendar.ts:623), \[calendar-month-view.ts:222\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/calendar-month-view.ts:222) | read | yes | derived/reporting-only | Accept as reporting input |  
| \`answer\_attempts\` | none in \`server\` \+ \`apps/api/src\` | none found | no evidence | unused/dead | Validate whether table is still required in live DB |

\#\# 4\. Tutor no-mastery proof

| Claim | Evidence file:line | PASS/FAIL/UNKNOWN |  
|---|---:|---|  
| tutor open without retry cannot call mastery RPC | \[tutor-runtime.ts:288\](C:/Users/14438/projects/Lyceonai/server/routes/tutor-runtime.ts:288), \[tutor-runtime.ts:1386\](C:/Users/14438/projects/Lyceonai/server/routes/tutor-runtime.ts:1386) (tutor tables only; no mastery call sites) | PASS |  
| tutor response without retry cannot call mastery RPC | \[tutor-runtime.ts:891\](C:/Users/14438/projects/Lyceonai/server/routes/tutor-runtime.ts:891), \[tutor-runtime.ts:1207\](C:/Users/14438/projects/Lyceonai/server/routes/tutor-runtime.ts:1207) | PASS |  
| verified retry can call mastery only through review outcome path | \[review-session-routes.ts:886\](C:/Users/14438/projects/Lyceonai/server/routes/review-session-routes.ts:886), \[review-session-routes.ts:905\](C:/Users/14438/projects/Lyceonai/server/routes/review-session-routes.ts:905) | PASS |  
| no tutor route directly writes mastery tables | \[tutor-runtime.ts:288\](C:/Users/14438/projects/Lyceonai/server/routes/tutor-runtime.ts:288) (table list excludes mastery/KPI tables) | PASS |

\#\# 5\. Practice / review / full-length evidence paths

| Source | Runtime truth table(s) | Mastery call site | Uses RPC? | Direct writes? | Status |  
|---|---|---:|---|---|---|  
| practice | \`practice\_session\_items\`, question snapshots, \`practice\_events\` | \[practice-canonical.ts:2257\](C:/Users/14438/projects/Lyceonai/server/routes/practice-canonical.ts:2257) | yes (via wrapper) | no canonical-table direct writes observed | canonical |  
| review | \`review\_error\_attempts\`, \`review\_session\_items\` | \[review-session-routes.ts:886\](C:/Users/14438/projects/Lyceonai/server/routes/review-session-routes.ts:886) | yes (via wrapper) | no canonical-table direct writes observed | canonical |  
| full-length exam | \`full\_length\_exam\_questions\`, \`full\_length\_exam\_responses\` | \[fullLengthExam.ts:2775\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:2775) \-\> \[fullLengthExam.ts:1867\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:1867) | yes (via wrapper) | no canonical-table direct writes observed | \*\*conflicting/blocker (Doc 04 seam)\*\* |  
| partial full-length exam | module submit path (\`submitModule\`) | \[fullLengthExam.ts:2624\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:2624), \[fullLengthExam.ts:2775\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:2775) | yes | no canonical-table direct writes observed | \*\*conflicting/blocker (Doc 04 seam)\*\* |

\#\# 6\. Doc 04 no-mastery-event alignment

| File:line | Event emitted | Source | Status |  
|---:|---|---|---|  
| \[fullLengthExam.ts:2775\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:2775) | per-question mastery bridge dispatch | module submission flow | violates Doc 04 locked seam |  
| \[fullLengthExam.ts:1867\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:1867) | mastery RPC call (\`sourceFamily: "test"\`) | full-length mastery signal loop | violates Doc 04 locked seam |  
| \[fullLengthExam.mastery-events.test.ts:165\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/\_\_tests\_\_/fullLengthExam.mastery-events.test.ts:165) | test asserts emission | test evidence | violates Doc 04 locked seam |

\#\# 7\. Tests currently present

| Test file:line | What it proves | Gaps |  
|---:|---|---|  
| \[mastery-writepaths.guard.test.ts:142\](C:/Users/14438/projects/Lyceonai/apps/api/test/mastery-writepaths.guard.test.ts:142) | Enforces single TS-side choke point for mastery writes | Does not validate live DB policy posture |  
| \[mastery.writepaths.guard.test.ts:202\](C:/Users/14438/projects/Lyceonai/tests/mastery.writepaths.guard.test.ts:202) | Enforces single choke point \+ no direct RPC outside wrapper | Filesystem scan only; no DB grants/rls checks |  
| \[mastery.event-routing.contract.test.ts:19\](C:/Users/14438/projects/Lyceonai/tests/mastery.event-routing.contract.test.ts:19) | Full-test routed via wrapper with \`sourceFamily: "test"\` | Conflicts with Doc 04 no-mastery-event posture |  
| \[review-errors.mastery-bridge.test.ts:174\](C:/Users/14438/projects/Lyceonai/tests/review-errors.mastery-bridge.test.ts:174) | Review pass emits canonical review mastery event | Does not assert DB-side RPC signature |  
| \[fullLengthExam.mastery-events.test.ts:165\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/\_\_tests\_\_/fullLengthExam.mastery-events.test.ts:165) | Full-length emits test mastery events | Confirms current seam violation, not prevention |

\#\# 8\. Required remediation list

| Severity | Issue | Evidence | Required fix |  
|---|---|---|---|  
| BLOCKER | Full-length emits per-question mastery events, conflicting with locked Doc 04 seam | \[fullLengthExam.ts:2775\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:2775), \[fullLengthExam.ts:1867\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts:1867) | Remove/disable full-length mastery emission until Doc 05 canonical path is approved |  
| BLOCKER | Migration-proxy policy exposes authenticated \`FOR ALL\` on \`student\_skill\_mastery\` | \[20251222\_student\_mastery\_tables.sql:111\](C:/Users/14438/projects/Lyceonai/supabase/migrations/20251222\_student\_mastery\_tables.sql:111) | Add migration to revoke broad authenticated write policy and keep service-role-only mutation |  
| HIGH | Canonical RPC definition/signature not visible in repo migrations | \[mastery-write.ts:74\](C:/Users/14438/projects/Lyceonai/apps/api/src/services/mastery-write.ts:74), no migration match for function DDL | Run SQL Script C/F against live DB; align docs/code to installed signature |  
| MEDIUM | \`student\_domain\_mastery\`, \`student\_section\_projections\`, \`student\_kpi\_rollups\_current\` schema/policy not found in migrations | repo-wide migration search had no hits | Pull live schema inventory (Scripts A/B/D/E/H/J) and reconcile migration history |

\#\# 9\. Exact validation commands run

\`\`\`bash  
rg \-n "apply\_learning\_event\_to\_mastery|applyMasteryUpdate|mastery-write|student\_skill\_mastery|student\_domain\_mastery|student\_section\_projections|student\_kpi\_rollups\_current|student\_kpi\_counters\_current|student\_kpi\_snapshots|user\_competencies|competency\_events|student\_question\_attempts|progress\\.ts|tutor\_helped|tutor\_fail|review\_pass|review\_fail|practice\_pass|practice\_fail|test\_pass|test\_fail|score\_runs|test\_session\_answers|full\_length\_exam" .  
rg \-n "tutor|tutor-v2|/api/tutor|Gemini|hint|retry|review\_error\_attempts|review\_session\_items|apply\_learning\_event\_to\_mastery|applyMasteryUpdate" server apps packages .  
rg \-n "exam\_runtime\_outbox|score\_runs|score\_run\_event\_ledger|test\_session\_answers|test\_session\_sections|test\_form\_items|full\_length\_exam|test\_pass|test\_fail|mastery" server apps packages supabase db .  
rg \-n "applyLearningEventToMastery|supabase\\.rpc\\(" apps/api/src/services/mastery-write.ts apps/api/src/services/studentMastery.ts server/routes/practice-canonical.ts server/routes/review-session-routes.ts apps/api/src/services/fullLengthExam.ts  
rg \-n "apply\_learning\_event\_to\_mastery" server apps/api/src  
rg \-n "student\_skill\_mastery" server apps/api/src  
rg \-n "student\_domain\_mastery|student\_section\_projections|student\_kpi\_rollups\_current|student\_kpi\_counters\_current|student\_kpi\_snapshots" server apps/api/src  
rg \-n "user\_competencies|competency\_events|answer\_attempts" server apps/api/src  
rg \-n "applyLearningEventToMastery|apply\_learning\_event\_to\_mastery|student\_skill\_mastery|student\_domain\_mastery|student\_section\_projections|student\_kpi\_rollups\_current|student\_kpi\_counters\_current|student\_kpi\_snapshots" server/routes/tutor-runtime.ts  
rg \-n "score\_runs|score\_run\_event\_ledger|exam\_runtime\_outbox|test\_session\_answers|test\_session\_sections|test\_answer\_submissions" server apps/api/src  
rg \-n "student\_kpi\_rollups\_current|student\_domain\_mastery|student\_section\_projections" supabase/migrations  
rg \-n "student\_skill\_mastery|FOR ALL USING \\(auth.uid\\(\\) \= user\_id\\)" supabase/migrations/20251222\_student\_mastery\_tables.sql  
\`\`\`

\#\# 10\. Final recommendation

\*\*BLOCK\_DOC\_05\_DRAFTING\_UNTIL\_REPO\_CLEANUP\*\*

Assumption applied for this report: \*\*migrations treated as DB truth proxy\*\*.    
If you want installed-state certainty, next step is to run your SQL Scripts A–L and re-issue with live DB outputs.  
