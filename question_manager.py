#!/usr/bin/env python3
"""
SAT Question Manager - Simple command-line tool for managing questions
Usage: python3 question_manager.py [command] [options]

Environment variables:
- LYCEON_API_URL: API base URL (default: http://localhost:5000)
- LYCEON_API_TOKEN: API authentication token (optional)
"""

import json
import requests
import sys
import argparse
import os
from typing import Optional, Dict, Any

BASE_URL = os.getenv("LYCEON_API_URL", "http://localhost:5000")


class QuestionManager:

    def __init__(self, api_url: Optional[str] = None, auth_token: Optional[str] = None):
        self.base_url = api_url or BASE_URL
        self.auth_token = auth_token or os.getenv("LYCEON_API_TOKEN")
        self.headers = {}
        if self.auth_token:
            self.headers["Authorization"] = f"Bearer {self.auth_token}"

    def get_all_questions(self,
                          limit: int = 50,
                          include_unvalidated: bool = False) -> list:
        """Get all questions for management"""
        params = {'limit': limit}
        if include_unvalidated:
            params['includeUnvalidated'] = 'true'

        response = requests.get(f"{self.base_url}/api/admin/questions",
                                params=params, headers=self.headers)
        response.raise_for_status()
        return response.json()

    def get_question(self, question_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific question by ID"""
        questions = self.get_all_questions(limit=500, include_unvalidated=True)
        return next((q for q in questions if q['id'] == question_id), None)

    def update_question(self, question_id: str, updates: Dict[str,
                                                              Any]) -> bool:
        """Update a question"""
        response = requests.put(
            f"{self.base_url}/api/admin/questions/{question_id}", 
            json=updates, headers=self.headers)
        return response.status_code == 200 and response.json().get('success')

    def delete_question(self, question_id: str) -> bool:
        """Delete a question"""
        response = requests.delete(
            f"{self.base_url}/api/admin/questions/{question_id}",
            headers=self.headers)
        return response.status_code == 200 and response.json().get('success')

    def list_questions_formatted(self, limit: int = 10):
        """List questions in a readable format"""
        questions = self.get_all_questions(limit=limit)

        print(f"\n=== SAT Questions (Total: {len(questions)}) ===\n")

        for i, q in enumerate(questions, 1):
            print(f"{i}. Question ID: {q['id']}")
            print(
                f"   Section: {q['section']} | Difficulty: {q['difficulty']}")
            print(f"   Document: {q['documentName']}")
            print(f"   Question: {q['stem'][:100]}...")
            print(f"   Answer: {q['answer']}")
            print(f"   Options: {len(q.get('options', []))} choices")
            print("   " + "=" * 60)

        return questions

    def search_questions(self, query: str) -> list:
        """Search questions by text"""
        questions = self.get_all_questions(limit=200)
        results = []
        query_lower = query.lower()

        for q in questions:
            if (query_lower in q['stem'].lower()
                    or query_lower in q.get('section', '').lower()
                    or query_lower in q.get('difficulty', '').lower()):
                results.append(q)

        return results


def main():
    parser = argparse.ArgumentParser(description="SAT Question Manager")
    subparsers = parser.add_subparsers(dest='command',
                                       help='Available commands')

    # List command
    list_parser = subparsers.add_parser('list', help='List questions')
    list_parser.add_argument('--limit',
                             type=int,
                             default=10,
                             help='Number of questions to show')

    # Show command
    show_parser = subparsers.add_parser('show', help='Show specific question')
    show_parser.add_argument('id', help='Question ID')

    # Update command
    update_parser = subparsers.add_parser('update', help='Update question')
    update_parser.add_argument('id', help='Question ID')
    update_parser.add_argument('--stem', help='Update question text')
    update_parser.add_argument('--difficulty',
                               choices=['Easy', 'Medium', 'Hard'],
                               help='Update difficulty')
    update_parser.add_argument('--section',
                               choices=['Math', 'Reading', 'Writing'],
                               help='Update section')
    update_parser.add_argument('--answer', help='Update correct answer')

    # Delete command
    delete_parser = subparsers.add_parser('delete', help='Delete question')
    delete_parser.add_argument('id', help='Question ID')
    delete_parser.add_argument('--confirm',
                               action='store_true',
                               help='Confirm deletion')

    # Search command
    search_parser = subparsers.add_parser('search', help='Search questions')
    search_parser.add_argument('query', help='Search query')

    args = parser.parse_args()
    manager = QuestionManager()

    try:
        if args.command == 'list':
            manager.list_questions_formatted(args.limit)

        elif args.command == 'show':
            question = manager.get_question(args.id)
            if question:
                print(f"\n=== Question Details ===")
                print(f"ID: {question['id']}")
                print(f"Section: {question['section']}")
                print(f"Difficulty: {question['difficulty']}")
                print(f"Document: {question['documentName']}")
                print(f"Question: {question['stem']}")
                print(f"Answer: {question['answer']}")
                if question.get('options'):
                    print("Options:")
                    for opt in question['options']:
                        print(f"  {opt['key']}) {opt['text']}")
                if question.get('explanation'):
                    print(f"Explanation: {question['explanation'][:200]}...")
            else:
                print(f"Question {args.id} not found")

        elif args.command == 'update':
            updates = {}
            if args.stem:
                updates['stem'] = args.stem
            if args.difficulty:
                updates['difficulty'] = args.difficulty
            if args.section:
                updates['section'] = args.section
            if args.answer:
                updates['answer'] = args.answer

            if not updates:
                print(
                    "No updates provided. Use --stem, --difficulty, --section, or --answer"
                )
                return

            success = manager.update_question(args.id, updates)
            if success:
                print(f"✅ Question {args.id} updated successfully")
            else:
                print(f"❌ Failed to update question {args.id}")

        elif args.command == 'delete':
            if not args.confirm:
                print("Use --confirm to delete the question")
                return

            success = manager.delete_question(args.id)
            if success:
                print(f"✅ Question {args.id} deleted successfully")
            else:
                print(f"❌ Failed to delete question {args.id}")

        elif args.command == 'search':
            results = manager.search_questions(args.query)
            print(
                f"\n=== Search Results for '{args.query}' ({len(results)} found) ===\n"
            )

            for i, q in enumerate(results[:10], 1):
                print(f"{i}. {q['id']} - {q['section']} ({q['difficulty']})")
                print(f"   {q['stem'][:100]}...")
                print("   " + "-" * 50)

        else:
            parser.print_help()

    except requests.exceptions.RequestException as e:
        print(f"❌ API Error: {e}")
        print(
            "Make sure the SAT Learning Copilot server is running on localhost:5000"
        )
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()
